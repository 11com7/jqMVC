//noinspection JSCheckFunctionSignatures
/**
 * ModelOneToManyDb - an extended jqMVC model class for sqlite database models with one-to-many relations.
 *
 * Copyright 2013 11com7, Bornheim, Germany
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
    function($, window, undefined) {
        'use strict';

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
        $.mvc.modelOneToManyDb = function(name, opts) {
            this._childs = [];
            this._childsChanged = {};
            this._childsLoaded = false;
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
        $.mvc.modelOneToManyDb.prototype.addChild = function(obj, callback) {
            var self = this;

            // save self first
            if (this.isNew()) {
                this.save($.proxy(self.addChild, self, arguments));
            }

            var newChild = $.extend(new this._childClass(), obj);
            newChild.id = 0; // set as �new� object
            newChild[this._childForeignKey] = this.id;

            newChild.save(function(newObj) {
                self._addChildSaved.call(self, newObj, callback)
            });
        };

        /**
         * (internal) will be called after a new child object was saved.
         * @param {$.mvc.modelDb} obj
         * @param callback
         * @private
         */
        $.mvc.modelOneToManyDb.prototype._addChildSaved = function(obj, callback) {
            this._childs.push(obj);
            delete (this._childsChanged[obj.id]);

            if ($.isFunction(callback)) {
                callback(obj);
            }
        };


        // --------------------------------------------------------------------------------
        // getChilds
        // --------------------------------------------------------------------------------
        $.mvc.modelOneToManyDb.prototype.getChilds = function(callback) {

        };


        // --------------------------------------------------------------------------------
        // getChild
        // --------------------------------------------------------------------------------
        $.mvc.modelOneToManyDb.prototype.getChild = function(id, callback) {

        };


        // ====================================================================================================
        // Child helper methods
        // ====================================================================================================
        // --------------------------------------------------------------------------------
        // _findChildPos / _childExists
        // --------------------------------------------------------------------------------
        /**
         * Returns the internal array index for a child with a given id; -1 if the child couldn't be found.
         * The caller has to guarantee that the childs are loaded.
         * @param id database id of the child
         * @return {Number} array index (0...n-1) OR -1 for non existing childs
         * @private
         */
        $.mvc.modelOneToManyDb.prototype._findChildPos = function(id) {
            for (var t = 0; t < this._childs.length; t++) {
                if (this._childs[t].id === id) {
                    return t;
                }
            }

            return -1;
        };

        /**
         * (internal) checks if a child exists.
         * The caller has to guarantee that the childs are loaded.
         * @param id database id of the child
         * @return {Boolean} TRUE if the child exists; else FALSE
         * @private
         */
        $.mvc.modelOneToManyDb.prototype._childExists = function(id) {
            return (this._findChildPos(id) !== -1);
        };


        // --------------------------------------------------------------------------------
        // _loadChilds
        // --------------------------------------------------------------------------------
        /**
         * (internal) load all childs for a parent object.
         * @param {Function} callback will be called on success
         * @param {Boolean} [reload] will fore a reload on TRUE
         * @private
         */
        $.mvc.modelOneToManyDb.prototype._loadChilds = function(callback, reload) {
            if (reload === true) {
                this._childsLoaded = false;
            }
            if (!this.isNew() && !this._childsLoaded) {
                var obj = new this._childClass(), self = this;
                obj.search(
                    {filter: [this._childForeignKey, "=", this.id], order: this._childForeignKey},
                    function(results) {
                        self._childs = results;
                        self._childsChanged = {};
                        self._childsLoaded = true;
                        if ($.isFunction(callback)) {
                            callback(self._childs);
                        }
                    }
                );
            } else if ($.isFunction(callback)) {
                callback(this._childs);
            }
        };


    })(jq, window);
