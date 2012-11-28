/**
 * ModelDb - an extended jqMVC model class for sqlite database models
 *
 * Copyright 2012 11com7, Bonn, Germany
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2012-11-27
 */
(function($, window, undefined)
{
  "use strict";

  /**
   * Internal extended model base class.
   * @param {String} name of new model
   * @param {Object} opts default methods/properties
   * @property {Number} id for object in the database (0 = new element)
   * @property {String|undefined} tableName can be set, to use an alternative table name instead of modelName
   * @property {function|undefined} __wakeup (optional) can be set, as "magic" callback used by StorageAdapter.get(), StorageAdapter.getAll() to manipulate data after loading
   * @property {function|undefined} __sleep (optional) can be set, as "magic" callback used by StorageAdapter.save() to manipulate data before saving
   */
  $.mvc.modelDb = function(name, opts)
  {
    this.id = 0;
    this.tableName = undefined;
    this.__wakeup = undefined;
    this.__sleep = undefined;

    $.mvc.model.apply(this, arguments);
  };

  //noinspection JSCheckFunctionSignatures
  $.mvc.modelDb.prototype = new $.mvc.model;
  $.mvc.modelDb.prototype.constructor = $.mvc.modelDb;

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
    "use strict";

    var el = new $.mvc.modelDb(this.modelName, baseOpts[this.modelName]),
    storageAdapter = this.getStorageAdapter();

    return storageAdapter.getAll.call(storageAdapter, this.modelName, callback, el);
  };

  /**
   * Set properties on the model. You can pass in a key/value or an object of properties.
   * @param {Object|String} obj
   * @param {*} [value] only used if obj ist key string
   */
  $.mvc.modelDb.prototype.set = function(obj, value){
    "use strict";

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
    this.setStorageAdapter(name, storageAdapter ? storageAdapter : SqliteStorageAdapter);
    return function(values) {
      var el = new $.mvc.modelDb(name, obj);
      if (values && $.isObject(values)) { el.set(values); }
      return el;
    }
  };

})(jq, window);