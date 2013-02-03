"use strict";

/**
 * SqliteStorageAdapter - manages model data in a SQLite database.
 * @author dom <d.pesch@11com7.de>
 * @since 2012-09-30
 */
var SqliteOneToManyStorageAdapter = (function($)
{
  var
    _protectedColumns = ['id', 'dt_create', 'dt_change']
    ;


  //noinspection FunctionWithInconsistentReturnsJS
  var SqliteOneToManyStorageAdapter = function(){
    // scope-safe constructor
    if (this instanceof SqliteOneToManyStorageAdapter)
    {
      this.dbQuery = null;
    }
    else
    {
      return new SqliteOneToManyStorageAdapter();
    }
  };

  SqliteOneToManyStorageAdapter.prototype = new SqliteStorageAdapter();
  SqliteOneToManyStorageAdapter.prototype.constructor = SqliteOneToManyStorageAdapter;


  // TODO: overwrite methods

  
  return SqliteOneToManyStorageAdapter;
})(jq);
