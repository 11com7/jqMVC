/**
 * ModelDb - an extended afMVC model class for sqlite database models
 *
 * Copyright 2012 11com7, Bornheim, Germany
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2012-11-27
 * @namespace {object} af.mvc
 */
(
/**
 * @param {af} $
 * @param {window} window
 * @param {undefined=} undefined
 * @export {af.mvc.model}
 */
function($, window, undefined)
{
  'use strict';

  /**
   * Internal extended model base class.
   *
   * IMPORTANT
   * ---------
   * + the model name `name` has to be unique (biunique!)
   * + if two models share the same table, the table has to be set in `opts.tableName`
   * 
   * @class
   * @param {String} name of new model (IMPORTANT: has to be unique for every model class!)
   * @param {af.mvc.modelDb|Object} opts default methods/properties
   * @extends {af.mvc.model}
   * @name af.mvc.modelDb
   */
  $.mvc.modelDb = function(name, opts)
  {
    /**
     * ID for object in the database (0 = new element)
     * @type {number}
     * @memberOf af.mvc.modelDb
     */
    this.id = 0;

    /**
     * sqlite table name (can be set, to use an alternative table name instead of modelName)
     * @type {undefined}
     * @memberOf af.mvc.modelDb
     */
    this.tableName = undefined;

    /**
     * @type {function()|undefined}
     * @memberOf af.mvc.modelDb
     */
    this.__init = undefined;

    /**
     * "magic" callback used by `StorageAdapter#get()`, `StorageAdapter#getAll()` to manipulate data after loading.
     * @type {function()|undefined}
     * @memberOf af.mvc.modelDb
     */
    this.__wakeup = undefined;

    /**
     * "magic" callback used by `StorageAdapter#save()` to manipulate (eg serialize) data BEFORE saving.
     * @type {function()|undefined}
     * @memberOf af.mvc.modelDb
     */
    this.__sleep = undefined;

    /**
     * "magic" callback used by {@link SqliteStorageAdapter.save()} to use the same transaction `tx`.
     * @type {function(SQLTransaction)|undefined}
     * @memberOf af.mvc.modelDb
     */
    this.__save = undefined;

    /**
     * "magic" callback used by {@link SqliteStorageAdapter.remove()} to use the same transaction `tx`.
     * @type {function(SQLTransaction, SQLResultSet)|undefined}
     * @memberOf af.mvc.modelDb
     */
    this.__remove = undefined;

    //noinspection JSUnresolvedVariable
    $.mvc.model.apply(this, arguments);
    this.tableName = opts.tableName || this.modelName;

    if (this.__init && $.isFunction(this.__init))
    {
      this.__init.apply(this);
    }
  };

  /**
   * @memberOf af.mvc.modelDb
   */
  $.mvc.modelDb.prototype = new $.mvc.model();

  /**
   * @memberOf af.mvc.modelDb
   */
  $.mvc.modelDb.prototype.constructor = $.mvc.modelDb;

  /**
   * "magic" Reference to parent class.
   * USE: <code>this.SUPER.func.call(this, args);</code>
   *
   * @memberOf af.mvc.modelDb
   */
  $.mvc.modelDb.prototype.SUPER = $.mvc.modelDb.prototype;

  /**
   * Loads entry with id and returns model object OR null (= not found!).
   *
   * <p><b>__wakeup() method</b>
   * get() supports a magic __wakeup() method in model. If this function could be found, it will called before passing the object to the callback function.
   * <code>this</code> refers to the loaded object!
   * <pre><code>
   *  var Model = new $.mvc.model.extend("model",
   *  {
   *    // ...
   *
   *    // this method will be called before the loaded object will be passed to callback()
   *    __wakeup : function()
   *    {
   *      // do something with "this"
   *
   *      return this;
   *    }
   *
   *    // ...
   *  }</code></pre>
   * </p>
   *
   * @param {Number} id
   * @param {function} [callback]
   * @return {Object} loaded object
   * @memberOf af.mvc.modelDb
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
        /** @type {af.mvc.modelDb} el */
        el = self.createNew();
        $.extend(el, obj);
        el.modelName = self.modelName;
        el.id = id;

        if (!!el.__wakeup && $.isFunction(el.__wakeup))
        {
          el = el.__wakeup.call(el);
        }
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
   * @memberOf af.mvc.modelDb
   */
  $.mvc.modelDb.prototype.getAll = function(callback){
    var storageAdapter = this.getStorageAdapter();

    return storageAdapter.getAll.call(storageAdapter, this.modelName, callback, this);
  };

  /**
   * Set properties on the model. You can pass in a key/value or an object of properties.
   * @param {Object|String} obj
   * @param {*} [value] only used if obj ist key string
   * @memberOf af.mvc.modelDb
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
   * Returns data keynames = all public attributes, which doesn't start with underscore(s) or a capital letter.
   * This function relies on correct attribute names!
   * @returns {Array}
   * @memberOf af.mvc.modelDb
   */
  $.mvc.modelDb.prototype.getDataKeys = function() {
    return Object.keys(this).filter(function(key) {
      return this.hasOwnProperty(key) && key.charAt(0) !== '_'
        && key.charAt(0) !== key.charAt(0).toUpperCase()
        && key !== 'modelName' && key !== 'tableName'&& key !== 'SUPER'
        && !$.isFunction(this[key]);
    }, this);
  };


  /**
   * Returns a clone of the model data (only a light clone!)
   * @return {Object} data object with cloned attributes
   * @memberOf af.mvc.modelDb
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
   * @param {function(SQLTransaction, SQLError)} [errorCallback]
   * @memberOf af.mvc.modelDb
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
   * @memberOf af.mvc.modelDb
   */
  $.mvc.modelDb.prototype.createNew = function() {
    return new $.mvc.modelDb(this.modelName, this.getBaseOptions());
  };


  /**
   * Returns a clone of the actual model
   * @return {$.mvc.modelDb}
   * @memberOf af.mvc.modelDb
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
   * @memberOf af.mvc.modelDb
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
   * @memberOf af.mvc.modelDb
   */
  $.mvc.modelDb.prototype.getTableName = function() {
    return (this.tableName) ? this.tableName : this.modelName;
  };

  /**
   * @returns {boolean}
   * @memberOf af.mvc.modelDb
   */
  $.mvc.modelDb.prototype.isNew = function() {
    return this.id === 0;
  }

})(af, window);
