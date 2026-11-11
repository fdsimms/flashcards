#include "unicase_compare.h"
#include "unicase_table.inc"

/* One string read as folded code points: UTF-8 decoded, each code point replaced by its folding. */
typedef struct {
  const unsigned char *s;
  int len;
  int pos;
  unsigned int pending[3];
  int npending;
  int next;
} folded_reader;

static unsigned int decode_utf8(folded_reader *r) {
  const unsigned char *s = r->s;
  unsigned int c = s[r->pos];
  int need = c < 0x80 ? 0 : (c & 0xE0) == 0xC0 ? 1 : (c & 0xF0) == 0xE0 ? 2 : (c & 0xF8) == 0xF0 ? 3 : -1;
  /* Not UTF-8 (a stray byte, or a sequence cut short): one replacement character per byte. */
  if (need < 0 || r->pos + need >= r->len) {
    r->pos += 1;
    return 0xFFFD;
  }
  unsigned int cp = need == 0 ? c : need == 1 ? (c & 0x1F) : need == 2 ? (c & 0x0F) : (c & 0x07);
  for (int i = 1; i <= need; i++) {
    unsigned int b = s[r->pos + i];
    if ((b & 0xC0) != 0x80) { r->pos += 1; return 0xFFFD; }
    cp = (cp << 6) | (b & 0x3F);
  }
  r->pos += need + 1;
  return cp;
}

static const unsigned int *lookup_fold(unsigned int cp) {
  int lo = 0, hi = UNICASE_FOLD_COUNT - 1;
  while (lo <= hi) {
    int mid = (lo + hi) / 2;
    unsigned int k = UNICASE_FOLDS[mid][0];
    if (k == cp) return &UNICASE_FOLDS[mid][1];
    if (k < cp) lo = mid + 1; else hi = mid - 1;
  }
  return 0;
}

/* The next folded code point, or -1 at the end. */
static long next_folded(folded_reader *r) {
  if (r->next < r->npending) return r->pending[r->next++];
  if (r->pos >= r->len) return -1;
  unsigned int cp = decode_utf8(r);
  if (cp < 0x80) return (cp >= 'A' && cp <= 'Z') ? cp + 32 : cp;
  const unsigned int *f = lookup_fold(cp);
  if (!f) return cp;
  r->npending = 0;
  r->next = 1;
  for (int i = 0; i < 3 && f[i]; i++) r->pending[r->npending++] = f[i];
  return r->pending[0];
}

int unicase_compare(void *unused, int len1, const void *s1, int len2, const void *s2) {
  (void)unused;
  folded_reader a = { (const unsigned char *)s1, len1, 0, {0}, 0, 0 };
  folded_reader b = { (const unsigned char *)s2, len2, 0, {0}, 0, 0 };
  for (;;) {
    long x = next_folded(&a);
    long y = next_folded(&b);
    if (x != y) return x < y ? -1 : 1;
    if (x < 0) return 0;
  }
}
