/**
 * @fileOverview jq.DbUpdater class
 * @namespace jq
 * @class jq.DbUpdater
 */
jq.DbUpdater = (function($)
{
  "use strict";

  /**
   * status: allows to add init-, update- and ready-functions.
   * @const
   */
  var STATUS_INIT = 0;

  /**
   * status: will be set on execution start; after every call to add... methods will throw an error.
   * @const
   */
  var STATUS_EXECUTE = 1;

  /**
   * status: will be set if the init- or update-functions are ready.
   * @const
   */
  var STATUS_READY = 2;

  /**
   * status: will be set after all ready functions are called.
   * @const
   */
  var STATUS_DONE = 3;

  /**
   * type: default type is unknown (will be set by execute()).
   * @const
   */
  var TYPE_UNKNOWN = 0;

  /**
   * type: database doesn't existst and has to be initialized (will be set by execute()).
   * @const
   */
  var TYPE_INIT = 1;

  /**
   * type: database exists and has to be updated (will be set by execute()).
   * @const
   */
  var TYPE_UPDATE = 2;


  /**
   * Event: will be triggered when execution starts.
   * @const
   */
  var EVENT_EXECUTE = "execute";

  /**
   * Event: will be triggered for every executed init- or update function.
   * @const
   */
  var EVENT_PROGRESS = "progress";

  /**
   *
    this._options = $.extend({}, this.defaultOptions, options);Event: will be triggered after all init- or update function are executed.
    * @const
    */
  var EVENT_READY = "ready";

  /**
   * Event: will be triggered after all ready function are executed.
   * @const
   */
  var EVENT_DONE = "done";


  /**
   * @name jq.DbUpdater
   * @param {$.db} db
   * @param {jq.DbUpdater.defaultOptions} [options]
   */
  function DbUpdater(db, options)
  {
    if (!(this instanceof DbUpdater)) { return new DbUpdater(db, options); }


    /**
     * 11com7 sql database helper.
     * @type {$.db}
     */
    this._db = db || $.db;

    /**
     * @type {jq.DbUpdater.defaultOptions}
     */
    this._options = $.extend({}, this.defaultOptions, options);
    if (!$.isFunction(this._options.debugFunc)) { this._options.debugFunc = function() {}; }

    /**
     * object status.
     * @type {Number}
     */
    this._status = STATUS_INIT;

    /**
     * object type (will be known/set in execute()).
     * @type {Number}
     */
    this._type = TYPE_UNKNOWN;

    /**
     * HTML database object for init- and update functions.
     * @type {?Database}
     */
    this._database = null;

    /**
     * init functions: will be called sequentially on new (empty) databases.
     * {Array.<function(SQLTransaction)>}
     * @type {Array}
     */
    this._initFuncs = [];

    /**
     * update functions: will be called sequentially on updates (= database already in use).
     * the version number will be updated after every update function
     * Array.<{{version:number, function(SQLTransaction}}>
     * @type {Array}
     */
    this._updateFuncs = [];

    /**
     * ready functions: will be called sequentially after the init- or update functions are executed.
     * {Array.<function(SQLTransaction)>}
     * @type {Array}
     */
    this._readyFuncs = [];

    /**
     * function call stack.
     * Array.<{{(version:number|0), function(SQLTransaction}}>
     * @type {Array}
     */
    this._runFuncs = [];


    /**
     * SQLTransaction for init and update functions.
     * @type {?SQLTransaction}
     */
    this._tx = null;

    return this;
  }



  DbUpdater.prototype =
  {
    /**
     * @ignore
     */
    constructor : DbUpdater,

    // --------------------------------------------------------------------------------
    // add...functions
    // --------------------------------------------------------------------------------
    /**
     * @param {function(SQLTransaction)} func
     * @return {DbUpdater}
     */
    addInitFunction : function(func)
    {
      if (this._status > STATUS_INIT) { throw new Error("DbUpdater error: already in execution or executed. Please use addInitFunction() before execute()."); }

      if (!!func && $.isFunction(func))
      {
        this._initFuncs.push(func);
      }

      return this;
    },

    /**
     * @param {!Number} version  has to be a continuous increasing integer (1, 2, 3, 4, …) version number
     * @param {function(SQLTransaction)} func
     * @return {DbUpdater}
     */
    addUpdateFunction : function(version, func)
    {
      if (this._status > STATUS_INIT) { throw new Error("DbUpdater error: already in execution or executed. Please use addUpdateFunction() before execute()."); }

      if (version <= 0) { version = this._getUpdateFuncVersionMax()+1; }

      if (this._updateFuncs.length > 0)
      {
        var prevVersion = this._updateFuncs[this._updateFuncs.length-1];
        if (version <= prevVersion)
        {
          throw new Error("DbUpdater error: new version (" + version + ") is lower or equal than the previous version (" + prevVersion + "). Please use increasing version numbers.");
        }
      }

      if (!!func && $.isFunction(func))
      {
        this._updateFuncs.push([version, func]);
      }

      return this;
    },

    /**
     * @this {DbUpdater}
     * @param {function()} func
     * @return {DbUpdater}
     */
    addReadyFunction : function(func)
    {
      if (this._status > STATUS_INIT) { throw new Error("DbUpdater error: already in execution or executed. Please use addReadyFunction() before execute()."); }

      if (!!func && $.isFunction(func))
      {
        this._readyFuncs.push(func);
      }

      return this;
    },

    /**
     * @return {DbUpdater}
     */
    execute : function()
    {
      // nothing to do
      if (this._initFuncs.length == 0 && this._updateFuncs.length == 0 && this._readyFunc.length == 0)
      {
        return this;
      }


      var self = this;

      // get version number -> no version table ==> init ELSE update
      this._openDatabase();
      this._database.transaction(
        function(tx)
        {
          var sql = "SELECT version FROM " + self._options.versionTable;
          tx.executeSql(sql, [],
            /**
             * UPDATE
             * @param {SQLTransaction} tx
             * @param {SQLResultSet} results
             */
            function(tx, results)
            {
              var version = results.rows.item(0).version;
              self.dbg("found version number", version, "=> type UPDATE");
              self._type = TYPE_UPDATE;
              self._startWith(version);
            },
            /**
             * ERROR
             * @param {SQLTransaction} tx
             * @param {SQLError} error
             */
            function(tx, error)
            {
              // ==> INIT
              if (error.message.toLowerCase().indexOf("no such table") > -1)
              {
                self.dbg("no version table '" + self._options.versionTable + "' found => type INIT");
                self._type = TYPE_INIT;
                self._startWith(0);
              }
              // ERROR
              else
              {
                var errorMsg = "SQL ERROR '" + error.message + "' #" + error.code + " in: '" + sql + "'";
                self.dbg(errorMsg);
                throw new Error(errorMsg);
              }
            });
        }
      );




      return this;
    },





    // --------------------------------------------------------------------------------
    // public helper
    // --------------------------------------------------------------------------------
    /**
     * Debug.
     */
    dbg : function()
    {
      var debugMsgs = Array.prototype.slice.call(arguments);
      debugMsgs.unshift("DbUpdater: ");
      console.log(this);
      console.log(this._options);
      console.log(this._options.debugFunc);
      console.dir(debugMsgs);
      this._options.debugFunc.apply(null, debugMsgs);
    },

    // --------------------------------------------------------------------------------
    // helper
    // --------------------------------------------------------------------------------
    /**
     * assigns (opens) the html database if not assigned.
     * @private
     */
    _openDatabase : function()
    {
      if (!this._database)
      {
       this._database = this._db.getDatabase();
      }
    },
    /**
     * returns the largest version number in this._updateFuncs.
     * @return {Number}
     * @private
     */
    _getUpdateFuncVersionMax : function()
    {
      var len = this._updateFuncs.length;
      return len > 0 ? this._updateFuncs[len-1][0] : 0;
    },
    // --------------------------------------------------------------------------------
    // Constants
    // --------------------------------------------------------------------------------
    /**
     * @readonly
     * @enum {Number}
     */
    STATUS :
    {
      INIT : STATUS_INIT,
      EXECUTE : STATUS_EXECUTE,
      READY : STATUS_READY,
      DONE : STATUS_DONE
    },


    /**
     * @readonly
     * @enum {String}
     */
    EVENT :
    {
      EXECUTE : EVENT_EXECUTE,
      PROGRESS : EVENT_PROGRESS,
      READY : EVENT_READY,
      DONE : EVENT_DONE
    },
    // --------------------------------------------------------------------------------
    // DefaultOptions
    // --------------------------------------------------------------------------------
    /**
     * @namespace jq.DbUpdater.defaultOptions
     * @property {String} [versionTable]
     * @property {function(String)} [errorFunc] will be called on errors with error:String
     * @property {function(...*)} [debugFunc] will be called for debug messages (should output arguments!)
     */
    defaultOptions :
    {
      versionTable : "_dbVersion",
      errorFunc : undefined,
      debugFunc : null
    }
  };


  return DbUpdater;
})(jq);