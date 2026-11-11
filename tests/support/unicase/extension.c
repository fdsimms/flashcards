/*
 * The app's unicase comparator (modules/anki-unicase/ios/unicase_compare.c) as a loadable SQLite
 * extension, so the tests write Anki's collated tables through the same code the phone uses.
 * Built by tests/support/unicase.ts.
 */
#include <sqlite3ext.h>
SQLITE_EXTENSION_INIT1
#include "../../../modules/anki-unicase/ios/unicase_compare.c"

#ifdef _WIN32
__declspec(dllexport)
#endif
int sqlite3_extension_init(sqlite3 *db, char **err, const sqlite3_api_routines *api) {
  (void)err;
  SQLITE_EXTENSION_INIT2(api);
  return sqlite3_create_collation_v2(db, "unicase", SQLITE_UTF8, 0, unicase_compare, 0);
}
