#ifndef UNICASE_REGISTER_H
#define UNICASE_REGISTER_H

/** Adds the unicase collation to every SQLite connection opened from now on. 0 on success. */
int anki_unicase_register(void);

#endif
