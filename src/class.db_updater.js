//noinspection JSCheckFunctionSignatures
/**
 * @fileOverview dbUpdate - A version updater for sqlite shemata.
 * Copyright 2013 11com7, Bonn, Germany
 *
 * @author Dominik Pesch <d.pesch@11com7.de>
 * @since 2013-02-21
 * @requires jq
 * @requires $.db#
 */

(
/**
 * @param {jq} jq
 * @param {Window} window
 * @param {undefined} [undefined]
 */
function(jq, window, undefined)
{
  "use strict";

  if (!jq.db || typeof jq.db !== "object")
  {
   throw new Error("$.db NOT defined. This plugin needs the 11com7-sqlite library. PLease load it first.");
  }


  // ====================================================================================================
  // constructor
  // ====================================================================================================
  //noinspection FunctionWithInconsistentReturnsJS
  /**
   * Sqlite Database Version Updater.
   * @class DbUpdater
   * @memberOf jq
   * @param {Database} [database]
   * @param {Object} options
   */
  jq.DbUpdater = function(database, options)
  {
    if (this instanceof jq.DbUpdater)
    {
      this._database = database || jq.db.getDatabase();
      this._options = jq.extend({}, jq.DbUpdater.prototype.defaultOptions, options);

      this._updates = [];
      this._status = jq.DbUpdater.STATUS_INIT;
    }
    else
    {
      return new jq.DbUpdater(database);
    }
  };


  // ====================================================================================================
  // constants
  // ====================================================================================================
  /**
   * status: initialization addUpdate() and execute() allowed.
   * @constant
   * @type Number
   */
  jq.DbUpdater.__defineGetter__( "STATUS_INIT", function() { return 0; } );

  /**
   * status: updates in progress.
   * @constant
   * @type Number
   */
  jq.DbUpdater.__defineGetter__( "STATUS_EXECUTE", function() { return 1; } );

  /**
   * status: updates are ready.
   * @constant
   * @type Number
   */
  jq.DbUpdater.__defineGetter__( "STATUS_READY", function() { return 2; } );


  // ====================================================================================================
  // prototype methods
  // ====================================================================================================
  jq.DbUpdater.prototype =
  {
    constructor : jq.DbUpdater,


    // --------------------------------------------------------------------------------
    // addUpdate
    // --------------------------------------------------------------------------------
    addUpdate : function(newVersion, updateFunc)
    {
      newVersion = newVersion || this._updates;
    },

    // --------------------------------------------------------------------------------
    //  DefaultOptions
    // --------------------------------------------------------------------------------
    defaultOptions : {
      versionTable : "_dbVersion",
      readyFunc : undefined
    }
  };


})(jq, window);