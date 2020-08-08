'use strict';

/**
 * SqliteStorageAdapter - manages model data in a SQLite database.
 * @author dom <d.pesch@11com7.de>
 * @since 2012-09-30
 */
var SqliteOneToManyStorageAdapter = (
    /**
     * @param {af} $
     * @return {Function}
     * @lends SqliteOneToManyStorageAdapter.prototype
     */
    function($) {
        var
            _protectedColumns = ['id', 'dt_create', 'dt_change']
        ;


        //noinspection FunctionWithInconsistentReturnsJS
        /**
         * @return {*}
         * @constructs
         */
        var SqliteOneToManyStorageAdapter = function() {
            // scope-safe constructor
            if (this instanceof SqliteOneToManyStorageAdapter) {
                this.db = null;
                this.dbQuery = null;
                this._tParentClass = null;
                this._tChildClass = null;
                this._saveT2No = -1;
                this._tx = null;
                this._cbReady = null;
                this._cbNext = null;
            } else {
                return new SqliteOneToManyStorageAdapter();
            }
        };

        SqliteOneToManyStorageAdapter.prototype = new SqliteStorageAdapter();
        SqliteOneToManyStorageAdapter.prototype.constructor = SqliteOneToManyStorageAdapter;


        // ===================================================================================================================
        // save()
        // ===================================================================================================================
        /**
         * @param {$.mvc.modelDb} obj
         * @param {function} [callback]
         * @requires $.db
         * @throws Error
         */
        SqliteOneToManyStorageAdapter.prototype.save = function(obj, callback) {
            console.log("SqliteOneToManyStorageAdapter->save(", obj, ')');
            if ($.isFunction(callback)) {
                callback(obj);
            }
            return;


            this.db = $.db.open();
            this._tx = null;
        };

        SqliteOneToManyStorageAdapter.prototype._saveStart = function(obj, callback) {

        };


        // TODO: overwrite methods


        return SqliteOneToManyStorageAdapter;
    })(af);
