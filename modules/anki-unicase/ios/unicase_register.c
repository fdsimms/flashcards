#include "unicase_register.h"
#include "unicase_compare.h"

/*
 * expo-sqlite compiles its own copy of SQLite with every function renamed sqlite3_* -> exsqlite3_*
 * (node_modules/expo-sqlite/vendor/sqlite3/sqlite3.h), so these are declared here by those names
 * rather than taken from the system's sqlite3.h, which would register with a different SQLite.
 * The values are SQLite's own (SQLITE_UTF8 is 1).
 */
typedef struct sqlite3 sqlite3;
extern int exsqlite3_auto_extension(void (*entry)(void));
extern int exsqlite3_create_collation_v2(
  sqlite3 *db, const char *name, int encoding, void *arg,
  int (*compare)(void *, int, const void *, int, const void *), void (*destroy)(void *));

static int add_collation(sqlite3 *db, char **err, const void *api) {
  (void)err;
  (void)api;
  return exsqlite3_create_collation_v2(db, "unicase", 1, 0, unicase_compare, 0);
}

int anki_unicase_register(void) {
  /* Registering the same entry point twice is a no-op in SQLite. */
  return exsqlite3_auto_extension((void (*)(void))add_collation);
}
