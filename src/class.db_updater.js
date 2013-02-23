/**
 * @fileOverview jq.DbUpdater class
 * @namespace jq
 * @class jq.DbUpdater
 */
jq.DbUpdater = (function($)
{
  "use strict";

  /**
   * @constructs
   * @name jq.DbUpdater
   * @param {$.db} db
   * @param {Object} [options]
   */
  function DbUpdater(db, options)
  {
    if (!this instanceof DbUpdater) { return new DbUpdater(db, options); }


    this._db = db || $.db;
    this._database = null;

    this.options = $.extend({}, this.defaultOptions, options);


  }



  /**
   * @this {DbUpdater}
   */
  DbUpdater.prototype =
  {
    /**
     * @ignore
     */
    constructor : DbUpdater,

    /**
     * @param {function(SQLTransaction)} func
     * @return {DbUpdater}
     */
    addInitFunction : function(func)
    {

      return this;
    },

    /**
     * @param {Number} version  has to be a continuous increasing integer (1, 2, 3, 4, …) version number
     * @param {function(SQLTransaction)} func
     * @return {DbUpdater}
     */
    addUpdateFunction : function(version, func)
    {

      return this;
    },

    /**
     * @this {DbUpdater}
     * @param {function()} func
     * @return {DbUpdater}
     */
    addReadyFunction : function(func)
    {


      return this;
    },

    /**
     * @return {DbUpdater}
     */
    execute : function()
    {
      return this;
    },







    /**
     * @this {DbUpdater}
     * @private
     */
    _openDatabase : function()
    {
      this._database = this._db.getDatabase();

    },
    // --------------------------------------------------------------------------------
    // DefaultOptions
    // --------------------------------------------------------------------------------
    /**
     * @namespace jq.DbUpdater.defaultOptions
     * @property {String} versionTable
     * @property {function(String)} errorFunc will be called on errors with error:String
     */
    defaultOptions :
    {
      versionTable : "_dbVersion",
      errorFunc : undefined
    }
  };


  return DbUpdater;
})(jq);