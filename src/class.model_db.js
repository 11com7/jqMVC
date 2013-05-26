/**
 * ModelDb - an extended jqMVC model class for sqlite database models
 *
 * Copyright 2012 11com7, Bonn, Germany
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2012-11-27
 * @memberOf jq.mvc
 */
(
/**
 * @param {jq} $
 * @param {window} window
 * @param {undefined=} undefined
 */
  function($, window, undefined)
{

  "use strict";

  /**
   * Internal extended model base class.
   * @class
   * @property {Number} id for object in the database (0 = new element)
   * @property {String|undefined} tableName can be set, to use an alternative table name instead of modelName
   * @property {function|undefined} __wakeup (optional) can be set, as "magic" callback used by StorageAdapter.get(), StorageAdapter.getAll() to manipulate data after loading
   * @property {function|undefined} __sleep (optional) can be set, as "magic" callback used by StorageAdapter.save() to manipulate data before saving
   * @property {function|undefined} __save (optional) can be set, as "magic" callback used by StorageAdapter.save() to
   * @property {function|undefined} __remove (optional) can be set, as "magic" callback used by StorageAdapter.remove() to manipulate data before saving
   * @param {String} name of new model
   * @param {Object} opts default methods/properties
   */
  $.mvc.modelDb = function(name, opts)
  {
    this.id = 0;
    this.tableName = undefined;
    this.__init = undefined;
    this.__wakeup = undefined;
    this.__sleep = undefined;
    this.__save = undefined;
    this.__remove = undefined;

    $.mvc.model.apply(this, arguments);
    this.tableName = opts.tableName || this.modelName;

    if (this.__init && $.isFunction(this.__init))
    {
      this.__init.apply(this);
    }
  };

  //noinspection JSCheckFunctionSignatures
  $.mvc.modelDb.prototype = new $.mvc.model();
  $.mvc.modelDb.prototype.constructor = $.mvc.modelDb;
  $.mvc.modelDb.prototype.SUPER = $.mvc.modelDb.prototype;

  /**
   * Loads entry with id and returns model object OR null (= not found!).
   * @param {Number} id
   * @param {function} [callback]
   * @return {Object} loaded object
   */
  $.mvc.modelDb.prototype.get = function(id, callback)
  {
    var self=this,
      el = new $.mvc.modelDb(this.modelName, this.getBaseOptions()),
      storageAdapter = this.getStorageAdapter();

    storageAdapter.get.call(storageAdapter, id, function(obj) {
      if (obj)
      {
        el = $.extend(el, obj);
        el.modelName = self.modelName;
        el.id = id;
      }
      else
      {
        el = null;
      }

      return (callback && $.isFunction(callback)) ? callback(el) : el;
    }, el);
  };

  /**
   * Loads all entries in an array with jq.mvc.modelDb objects.
   * An empty table results in an empty array.
   *
   * @param {function} [callback]
   * @return {Array}
   */
  $.mvc.modelDb.prototype.getAll = function(callback){
    var el = new $.mvc.modelDb(this.modelName, this.getBaseOptions()),
    storageAdapter = this.getStorageAdapter();

    return storageAdapter.getAll.call(storageAdapter, this.modelName, callback, el);
  };

  /**
   * Set properties on the model. You can pass in a key/value or an object of properties.
   * @param {Object|String} obj
   * @param {*} [value] only used if obj ist key string
   */
  $.mvc.modelDb.prototype.set = function(obj, value){
    var readOnlyVars = ["id", "modelName", "tableName"];

    if (obj && $.isObject(obj))
    {
      readOnlyVars.map( function(el) { if (obj[el]) { delete obj[el]; } } );
      for (var t in obj)
      {
        if (this.hasOwnProperty(t))
        {
          this[t] = obj[t];
        }
      }
    }
    else if (obj && this.hasOwnProperty(obj))
    {
      if (!readOnlyVars.some( function(el) { return ( obj.toLowerCase() === el.toLowerCase() ); } ))
      {
        this[obj] = value;
      }
    }
  };


  /**
   * Search (selects) elements from the database.
   * @param {Object} search
   * @param {Function} callback
   * @param {Function} errorCallback
   */
  $.mvc.modelDb.prototype.search = function(search, callback, errorCallback)
  {
    var el = new $.mvc.modelDb(this.modelName, this.getBaseOptions()),
      storageAdapter = this.getStorageAdapter();

    storageAdapter.search.call(storageAdapter, el, search, callback, errorCallback);
  };


  /**
   * <p>This is called to create a new extended model type for database storage adapters.
   * You pass in the name, default properties and an optional storage adapter.</p>
   * <pre><code>
   * $.mvc.model.extend('model',{foo:'bar'})
   * $.mvc.model.extend('model',{foo:'bar'},myCustomAdapter)
   * </code></pre>
   * @param {String} name
   * @param {Object} obj default methods/properties
   * @param {Object} [storageAdapter] - object implementing storageAdapter interface (look below for the default)
   */
  $.mvc.modelDb.extend = function(name, obj, storageAdapter) {
    // creates
    if (!(storageAdapter instanceof SqliteStorageAdapter))
    {
      storageAdapter = new storageAdapter();
    }

    $.mvc.model.extend(name, obj, storageAdapter ? storageAdapter : new SqliteStorageAdapter());

    return function(values) {
      var el = new $.mvc.modelDb(name, obj);
      if (values && $.isObject(values)) { el.set(values); }
      return el;
    }
  };


  /**
   * @return {String} table name from tableName (or modelName).
   */
  $.mvc.modelDb.prototype.getTableName = function() {
    return (this.tableName) ? this.tableName : this.modelName;
  };

  $.mvc.modelDb.prototype.isNew = function() {
    return this.id === 0;
  }

})(jq, window);