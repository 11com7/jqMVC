/**
 * @fileOverview af.DbUpdater class
 * @namespace af
 * @class af.DbUpdater
 */
af.DbUpdater = (function(/** af */ $)
{
  'use strict';


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
   * @name af.DbUpdater
   * @this af.DbUpdater.prototype
   * @param {$.db} db
   * @param {af.DbUpdater.defaultOptions} [options]
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
     * @type {af.DbUpdater.defaultOptions}
     */
    this._options = $.extend({}, this.defaultOptions, options);
    if (!$.isFunction(this._options.debugFunc)) { this._options.debugFunc = function() {}; }

    /**
     * object status.
     * @type {Number}
     */
    this._status = STATUS_INIT;

    /**
     * TRUE if the db-updater has run already once.
     * @type {boolean}
     */
    this._alreadyExecuted = false;

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
     * will be set to TRUE after the internal init version update function was added.
     * @type {boolean}
     * @private
     */
    this._initVersionFuncAdded = false;

    /**
     * update functions: will be called sequentially on updates (= database already in use).
     * the version number will be updated after every update function
     * Array.<{{version:number, function(SQLTransaction, version:Number)}}>
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
     *  reExecute functions: will be called after re-execution.
     *  {Array.<function(SQLTransaction)>}
     * @type {Array}
     */
    this._reExecuteFuncs = [];

    /**
     * function call stack.
     * Array.<{{(version:number|0), function(SQLTransaction}}>
     * @type {Array}
     */
    this._runFuncs = [];


    /**
     * Max number of functions to execute (init|update + ready funcs).
     * @type {Number}
     */
    this._runFuncsMax = 0;

    /**
     * Tick/value for progress events.
     * @type {Number}
     */
    this._runTick = 0;


    this._db.addTable(this._options.versionTable,
      [
        ["version", "INTEGER", "NOT NULL UNIQUE"],
        ["dt_create"]
      ]
    );

    return this;
  }



  /**
   * @name af.DbUpdater.prototype
   * @this af.DbUpdater.prototype
   */
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

      this.dbg("addInitFunction(", typeof(func), ")");

      if (!!func && $.isFunction(func))
      {
        this._initFuncs.push(func);
      }

      return this;
    },

    /**
     * @param {!Number} vers  version, has to be a continuous increasing integer (1, 2, 3, 4, …) version number
     * @param {function(SQLTransaction)} func
     * @return {DbUpdater}
     */
    addUpdateFunction : function(vers, func)
    {
      if (this._status > STATUS_INIT) { throw new Error("DbUpdater error: already in execution or executed. Please use addUpdateFunction() before execute()."); }

      var version = vers > 0 ? vers : this._getUpdateFuncVersionMax()+1;
      this.dbg("addUpdateFunction(", vers, typeof(func), ") --> version: ", version);

      if (this._updateFuncs.length > 0)
      {
        var prevVersion = this._updateFuncs[this._updateFuncs.length-1][0];
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
      if (this._status > STATUS_INIT) { throw new Error("DbUpdater error: exceute() has already called. Please use addReadyFunction() before execute()."); }

      this.dbg("addReadyFunction(", typeof(func), ")");

      if (!!func && $.isFunction(func))
      {
        this._readyFuncs.push(func);
      }

      return this;
    },


    // --------------------------------------------------------------------------------
    // execute
    // --------------------------------------------------------------------------------
    /**
     * @return {DbUpdater}
     */
    execute : function()
    {
      if (this._status > STATUS_INIT) { console.error("DbUpdater error: exceute() has already called. Please use re-execute!"); return this; }

      // nothing to do
      if (this._initFuncs.length == 0 && this._updateFuncs.length == 0 && this._readyFunc.length == 0)
      {
        return this;
      }

      /**
       * @type {DbUpdater#}
       */
      var self = this;

      // get version number -> no version table ==> init ELSE update
      this._openDatabase();
      this._database.transaction(
        function(tx)
        {
          var sql = "SELECT MAX(version) as version FROM " + self._options.versionTable;
          $.db.executeSql(tx, sql, [],
            /**
             * UPDATE
             * @param {SQLTransaction} tx
             * @param {SQLResultSet} results
             */
            function(tx, results)
            {
              if (results.rows.length > 0)
              {
                if (results.rows.item(0).version > 0)
                {
                  self._prepareUpdateExecution.call(self, results.rows.item(0).version);
                }
                else
                {
                  self._prepareInitExecution.call(self);
                }
              }
              // error corrupt version table => try init
              else
              {
                self.dbg("CORRUPT VERSION TABLE --> TRY RE-INIT");
                sql = "DROP TABLE " + self._options.versionTable;
                $.db.executeSql(tx, sql, self._prepareInitExecution.call(self));
              }
            },
            /**
             * INIT OR ERROR
             * @param {SQLTransaction} tx
             * @param {SQLError} error
             */
            function(tx, error)
            {
              // ==> INIT
              if (error.message.toLowerCase().indexOf("no such table") > -1)
              {
                self._prepareInitExecution.call(self);
              }
              // ERROR
              else
              {
                throw new Error($.db.SqlError(error));
              }
            });
        }
      );

      return this;
    },


    /**
     * Re-Starts the execution after execution() has been called before.
     * @param {function(SQLTransaction)} readyCallback
     * @returns {DbUpdater}
     */
    reExecute : function(readyCallback)
    {
      if (!this._alreadyExecuted) { throw new Error("DbUpdater error: exceute() has to be runned before."); }

      this._status = STATUS_INIT;

      this._reExecFunction = $.isFunction(readyCallback) ? readyCallback : false;

      return this.execute();
    },


    // --------------------------------------------------------------------------------
    // execution helper
    // --------------------------------------------------------------------------------
    _prepareInitExecution : function()
    {
      var self = this;

      this.dbg("no version table '" + self._options.versionTable + "' found => type INIT");
      this._type = TYPE_INIT;

      if (!this._initVersionFuncAdded)
      {
        this.addInitFunction(function(tx)
        {
          self._insertVersion(tx, self._getUpdateFuncVersionMax.call(self));
        });

        this._initVersionFuncAdded = true;
      }

      this._prepareExecution.call(this, 0, this._initFuncs);
      this._startExecution( $.proxy(this._prepareReadyCallbacks, this) );
    },


    _prepareUpdateExecution : function(version)
    {
      this.dbg("found version number", version, "=> type UPDATE");
      this._type = TYPE_UPDATE;
      this._prepareExecution.call(this, version, this._updateFuncs);
      this._startExecution( $.proxy(this._prepareReadyCallbacks, this) );
    },


    /**
     * adds functions to call stack (_runFuncs); if version > 0 then only functions with versions > version are added.
     * if version > 0 the functions array has to be Array.<{{version:number, function(SQLTransaction}}>.
     * @param {Number} version
     * @param {Array} functions
     */
    _prepareExecution : function(version, functions)
    {
      var stack = this._runFuncs = [];
      for (var t = 0; t < functions.length; t++)
      {
        if (version <= 0)
        {
          stack.push([0, functions[t]]);
        }
        else if (version < functions[t][0])
        {
          stack.push(functions[t]);
        }
      }

      // calc max only the first time
      if (this._runFuncsMax === 0)
      {
        this._runFuncsMax = stack.length + this._readyFuncs.length;
      }
    },

    _startExecution : function(readyCallback)
    {
      this._openDatabase();

      if (!this._alreadyExecuted || this._options.triggerEventsOnReExecute)
      {
        $.trigger(this, EVENT_EXECUTE);
      }

      this._nextExecution(readyCallback);
    },

    _nextExecution : function(readyCallback)
    {
      // next one
      if (this._runFuncs.length)
      {
        var version, func = this._runFuncs.shift();
        version = func[0];
        func = func[1];

        this.dbg("execute version: #" + version);

        var self = this;
        this._database.transaction(
          function(tx)
          {
            if (!this._alreadyExecuted || this._options.triggerEventsOnReExecute)
            {
              $.trigger(self, EVENT_PROGRESS, [{ "value" : ++self._runTick,  "max" : self._runFuncsMax }]);
            }

            func.call(null, tx, version);
          },
          // ERROR
          function(error)
          {
            self.dbg("SQL-ERROR (Version " + version + ") --- ROLL BACK --- !");

            if ($.isFunction(self._options.errorFunc))
            {
              self._options.errorFunc.call(null, error);
            }
            else
            {
              throw new Error($.db.SqlError(error));
            }
          },
          // SUCCESS
          function(tx, results)
          {
            self.dbg("Update installed (Version " + version + ")");

            if (version > 0)
            {
              self._insertVersion(tx, version);
            }

            // lastUpdateFunc??? ==> ready!
            if (0 === self._runFuncs.length)
            {
              self.dbg("--> EXECUTE READY");
              readyCallback.call(self, results);
            }
            else
            {
              self.dbg("--> EXECUTE NEXT UPDATE");
              self._nextExecution(readyCallback);
            }
          }
        );
      }
      // nothing to do!
      else
      {
        this.dbg("NOTHING TODO --> EXECUTE READY");
        readyCallback.call(this, null);
      }
    },


    _insertVersion : function(tx, version)
    {
      this.dbg("set version to #" + version);
      var sql = "INSERT OR IGNORE INTO " + this._options.versionTable + " (version) VALUES (?)";
      //noinspection JSValidateTypes
      $.db.executeSql(tx, sql, [version]);
    },


    // --------------------------------------------------------------------------------
    // READY CALLBACKS
    // --------------------------------------------------------------------------------
    _prepareReadyCallbacks : function()
    {
      this.dbg("==> READY -->", (!this._alreadyExecuted || this._options.recallReadyFunctionsOnReExecute) ? '' : "don't" , "call ready functions");
      this._status = STATUS_READY;

      if (!this._alreadyExecuted_alreadyExecuted || this._options.triggerEventsOnReExecute)
      {
        $.trigger(this, EVENT_READY);
      }

      var readyFuncs = (!this._alreadyExecuted || this._options.recallReadyFunctionsOnReExecute) ? this._readyFuncs : [];
      this._prepareExecution(0, readyFuncs);

      var self = this;
      this._nextExecution(function()
      {
        self.dbg("==> DONE!");

        if (!this._alreadyExecuted || this._options.triggerEventsOnReExecute)
        {
          $.trigger(self, EVENT_DONE);
        }

        self._status = STATUS_DONE;
        this._alreadyExecuted = true;

        if (self._reExecFunction && $.isFunction(self._reExecFunction))
        {
          self._reExecFunction();
        }
      });
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
      this._options.debugFunc.apply(null, debugMsgs);
    },

    // --------------------------------------------------------------------------------
    // helper
    // --------------------------------------------------------------------------------
    /**
     * assigns (opens) the html database if not assigned.
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
     */
    _getUpdateFuncVersionMax : function()
    {
      var len = this._updateFuncs.length;
      return len > 0 ? this._updateFuncs[len-1][0] : 1;
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
     * @namespace af.DbUpdater.defaultOptions
     * @property {String} [versionTable]
     * @property {function(String)} [errorFunc] will be called on errors with error:String
     * @property {function(...*)} [debugFunc] will be called for debug messages (should output arguments!)
     */
    defaultOptions :
    {
      versionTable : "_dbVersion",
      errorFunc : undefined,
      debugFunc : null,
      triggerEventsOnReExecute : false,
      recallReadyFunctionsOnReExecute : false
    }
  };


  return DbUpdater;
})(af);
