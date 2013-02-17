//noinspection JSCheckFunctionSignatures
/**
 * ModelOneToManyDb - an extended jqMVC model class for sqlite database models with one-to-many relations.
 *
 * Copyright 2013 11com7, Bonn, Germany
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2013-02-17
 */
(function($, window, undefined)
{
  "use strict";

  /**
   * Internal extended model base class for one-to-many relations.
   * @param {String} name of new model
   * @param {Object} opts default methods/properties
   * @property {Number} id for object in the database (0 = new element)
   * @property {String|undefined} tableName can be set, to use an alternative table name instead of modelName
   * @property {Array} _childs num array with child objects
   * @property {Object} _childsChanged childIds => true for childs with changes
   * @property {String} _childClass class name of child objects
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
    this._childOrder = undefined;
    this._childLimit = undefined;

    $.mvc.modelDb.apply(this, arguments);
    this.tableName = opts.tableName || this.modelName;
  };

  //noinspection JSCheckFunctionSignatures
  $.mvc.modelDb.prototype = new $.mvc.modelDb;
  $.mvc.modelDb.prototype.constructor = $.mvc.modelOneToManyDb;


  // ====================================================================================================
  // Child public methods
  // ====================================================================================================
  // --------------------------------------------------------------------------------
  // addChild
  // --------------------------------------------------------------------------------
  $.mvc.modelDb.prototype.addChild = function(obj, callback)
  {

  };

  // ====================================================================================================
  // Child helper methods
  // ====================================================================================================



})(jq, window);