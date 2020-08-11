jqMVC
=====

lightweight MVC framework built on top of jqMobi

**DEPRECATED – not activiley maintained – used only for legacy compatibility!**


SQLite fork
-----------
This is a fork which extends the model for SQLite database support using the (deprecated) [W3C Web SQL Database interface]
(http://www.w3.org/TR/webdatabase/):
* extends jq.mvc.model
* get(), getAll(), remove(), set()
* »magic« methods __sleep(), wakeup() to convert data before saving / after loading


This fork uses our – not ready – sqlite lib:
* ~~very easy single db approach~~ (supports more than database now)
* easy database definition (addTable(
* auto init (creates tables, ...)
* auto date time columns for new entries (dt_create) and updated rows (dt_change) using a trigger
* supports auto collate settings for text types
* offers trigger for :open, :close database
* database updater for sqlite databases
* it could backup and restore databases
