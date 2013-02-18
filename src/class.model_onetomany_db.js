//noinspection JSCheckFunctionSignatures
/**
 * ModelOneToManyDb - an extended jqMVC model class for sqlite database models with one-to-many relations.
 *
 * Copyright 2013 11com7, Bonn, Germany
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2013-02-17
 */
(
/**
 * @class jq.mvc.modelOneToManyDb
 * @param {jq} $
 * @param {window} window
 * @param {undefined=} undefined
 */
function($, window, undefined)
{
  "use strict";

  /**
   * Internal extended model base class for one-to-many relations.
   * @class
   * @param {String} name of new model
   * @param {Object} opts default methods/properties
   * @property {Number} id for object in the database (0 = new element)
   * @property {String|undefined} tableName can be set, to use an alternative table name instead of modelName
   * @property {Array} _childs num array with child objects
   * @property {Object} _childsChanged childIds => true for childs with changes
   * @property {String} _childClass class name of child objects
   * @property {String} _childForeignKey name for foreign key
   * @property {String|Array} _childOrder sql order parameter for child loading
   * @property {Number|String|Array} _childLimit sql limit parameter
   * @property {function|undefined} __wakeup (optional) can be set, as "magic" callback used by StorageAdapter.get(), StorageAdapter.getAll() to manipulate data after loading
   * @property {function|undefined} __sleep (optional) can be set, as "magic" callback used by StorageAdapter.save() to manipulate data before saving
   */
  $.mvc.modelOneToManyDb = function(name, opts)
  {
    this._childs = [];
    this._childsChanged = {};
    this._childClass = undefined;
    this._childForeignKey = undefined;
    this._childOrder = undefined;
    this._childLimit = undefined;

    $.mvc.modelDb.apply(this, arguments);
    this.tableName = opts.tableName || this.modelName;
  };

  //noinspection JSCheckFunctionSignatures
  $.mvc.modelOneToManyDb.prototype = new $.mvc.modelDb;
  $.mvc.modelOneToManyDb.prototype.constructor = $.mvc.modelOneToManyDb;


  // ====================================================================================================
  // Child public methods
  // ====================================================================================================
  // --------------------------------------------------------------------------------
  // addChild
  // --------------------------------------------------------------------------------
  /**
   * Adds an object as child, saves it in the database and add it
   * @param {Object|$.mvc.modelDb} obj
   * @param {Function} callback
   */
  $.mvc.modelOneToManyDb.prototype.addChild = function(obj, callback)
  {
    var self = this;

    // save self first
    if (this.isNew())
    {
      this.save($.proxy(self.addChild, self, arguments));
    }

    var newChild = $.extend(new this._childClass(), obj);
    newChild.id = 0; // set as »new« object
    newChild[this._childForeignKey] = this.id;

    newChild.save( function(newObj) { self._addChildSaved.call(self, newObj, callback) } );
  };

  /**
   * (internal) will be called after a new child object was saved.
   * @param {$.mvc.modelDb} obj
   * @param callback
   * @private
   */
  $.mvc.modelOneToManyDb.prototype._addChildSaved = function(obj, callback)
  {
    this._childs.push(obj);
    delete(this._childsChanged[obj.id]);

    if ($.isFunction(callback)) { callback(obj); }
  };

  // ====================================================================================================
  // Child helper methods
  // ====================================================================================================



})(jq, window);