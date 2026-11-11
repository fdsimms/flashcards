#ifndef UNICASE_COMPARE_H
#define UNICASE_COMPARE_H

/*
 * Anki's `unicase` collation: two strings compared code point by code point after Unicode full
 * case folding, as the `unicase` Rust crate's `UniCase::cmp` does (rslib/src/storage/sqlite.rs,
 * `unicase_compare`). Same signature as SQLite's collation callback.
 */
int unicase_compare(void *unused, int len1, const void *s1, int len2, const void *s2);

#endif
