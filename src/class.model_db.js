/**
 * ModelDb - an extended afMVC model class for sqlite database models
 *
 * Copyright 2012 11com7, Bonn, Germany
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2012-11-27
 * @memberOf af.mvc
 */
(
/**
 * @param {af} $
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
   * @property {function|undefined} __wakeup (optional) can be set, as "magic" callback used by StorageAdapter#get(), StorageAdapter.getAll() to manipulate data after loading
   * @property {function|undefined} __sleep (optional) can be set, as "magic" callback used by StorageAdapter#save() to manipulate data before saving
   * @property {function|undefined} __save (optional) can be set, as "magic" callback used by StorageAdapter#save() to use the same transaction as save()
   * @property {function|undefined} __remove (optional) can be set, as "magic" callback used by StorageAdapter.remove() to manipulate data before saving
   * @param {String} name of new model
   * @param {Object} opts default methods/properties
   * @extends $.mvc.model
   * @this $.mvc.modelDb
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
   * @this $.mvc.modelDb
   */
  $.mvc.modelDb.prototype.get = function(id, callback)
  {
    var
      self=this,
      storageAdapter = this.getStorageAdapter();

    storageAdapter.get.call(storageAdapter, id, function(obj) {
      var el;

      if (obj)
      {
        el = self.createNew();
        $.extend(el, obj);
        el.modelName = self.modelName;
        el.id = id;
      }
      else
      {
        el = null;
      }

      return (callback && $.isFunction(callback)) ? callback(el) : el;
    }, this);
  };

  /**
   * Loads all entries in an array with af.mvc.modelDb objects.
   * An empty table results in an empty array.
   *
   * @param {function} [callback]
   * @return {Array}
   * @this $.mvc.modelDb
   */
  $.mvc.modelDb.prototype.getAll = function(callback){
    var storageAdapter = this.getStorageAdapter();

    return storageAdapter.getAll.call(storageAdapter, this.modelName, callback, this);
  };

  /**
   * Set properties on the model. You can pass in a key/value or an object of properties.
   * @param {Object|String} obj
   * @param {*} [value] only used if obj ist key string
   * @this $.mvc.modelDb
   */
  $.mvc.modelDb.prototype.set = function(obj, value){
    var readOnlyVars = ["id", "modelName", "tableName", "SUPER", "prototype"];

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
   * Returns data keynames = all public attributes, which doesn't start with underscore(s).
   * This function relies on correct attribute names!
   * @returns {Array}
   * @this $.mvc.modelDb
   */
  $.mvc.modelDb.prototype.getDataKeys = function() {
    return Object.keys(this).filter(function(key) {
      return this.hasOwnProperty(key) && key.substr(0,1) !== '_'
        && key !== 'modelName' && key !== 'tableName'&& key !== 'SUPER'
        && !$.isFunction(this[key]);
    }, this);
  };


  /**
   * Returns a clone of the model data (only a light clone!)
   * @return {Object} data object with cloned attributes
   */
  $.mvc.modelDb.prototype.getData = function() {
    var back = {}, self=this;
    this.getDataKeys().forEach(function(key)
    {
      var el = self[key], type = $.typeOf(el), val;

      if ('Date' === type)
      {
        val = new Date( el.getTime() );
      }
      else if ('Array' === type)
      {
        val = el.slice(0);
      }
      else if ('Object' === type)
      {
        val = $.extend({}, el);
      }
      else
      {
        val = el;
      }

      back[key] = val;
    });

    return back;
  };


  /**
   * Search (selects) elements from the database.
   *
   * Search-Quer-Objekt<pre>
   *  {
   *    filter : {Array},             // Filter/Query
   *    columns : {Array|null},       // (Array) existing Columns or $.SqlClause-Objects; (null) all columns
   *    limit : {Number|Array|null},  // default: 0; (optional)
   *    operator : {String},          // Default-Operator (optional, default: AND); ['AND', 'OR', 'XOR', 'NOT']
   *    order : {String|Array}        // Query-Order (optional)
   *  }</pre>
   *
   * @param {Object} search
   * @param {function(Array.<Object|$.mvc.modelDb>)} callback Array with model objects
   * @param {function(SQLTransaction, SQLError)} errorCallback
   * @this $.mvc.modelDb
   */
  $.mvc.modelDb.prototype.search = function(search, callback, errorCallback)
  {
    var el = new $.mvc.modelDb(this.modelName, this.getBaseOptions()),
      storageAdapter = this.getStorageAdapter();

    storageAdapter.search.call(storageAdapter, el, search, callback, errorCallback);
  };


  /**
   * Returns a new - empty - object of the actual model
   * @return {$.mvc.modelDb}
   * @this $.mvc.modelDb
   */
  $.mvc.modelDb.prototype.createNew = function() {
    return new $.mvc.modelDb(this.modelName, this.getBaseOptions());
  };


  /**
   * Returns a clone of the actual model
   * @return {$.mvc.modelDb}
   * @this $.mvc.modelDb
   */
  $.mvc.modelDb.prototype.clone = function() {
    var clone = this.createNew();
    $.extend(clone, this.getData());
    return clone;
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
   * @this $.mvc.modelDb
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
   * @this $.mvc.modelDb
   */
  $.mvc.modelDb.prototype.getTableName = function() {
    return (this.tableName) ? this.tableName : this.modelName;
  };

  $.mvc.modelDb.prototype.isNew = function() {
    return this.id === 0;
  }

})(af, window);
