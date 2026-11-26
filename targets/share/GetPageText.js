// Run by Safari in the page being shared to Franki (NSExtensionJavaScriptPreprocessingFile in
// plugins/withShareExtension.js). It reads the page as it is on screen, so a page the person is
// signed in to works, and nothing is fetched by Franki or its server. It hands the extension the
// page's title and address, what's selected, and the article's text: the paragraphs of the
// <article> (or <main>, or the page) holding the most text, one paragraph per line, blank lines
// between, which is how Your own text splits paragraphs (server/reader own_text.py).
var FrankiGetPageText = function () {};

FrankiGetPageText.prototype = {
  run: function (args) {
    var selection = '';
    try {
      selection = String(window.getSelection() || '').trim();
    } catch (e) {}
    var text = '';
    try {
      text = frankiArticleText();
    } catch (e) {}
    args.completionFunction({
      title: document.title || '',
      url: document.URL || '',
      selection: selection,
      text: text,
    });
  },
  finalize: function () {},
};

function frankiArticleText() {
  var candidates = Array.prototype.slice.call(document.querySelectorAll('article, main, [role="main"]'));
  var root = document.body;
  var most = 0;
  for (var i = 0; i < candidates.length; i++) {
    var length = (candidates[i].innerText || '').length;
    if (length > most) {
      most = length;
      root = candidates[i];
    }
  }
  var blocks = root.querySelectorAll('h1, h2, h3, p, li, blockquote');
  var paragraphs = [];
  for (var j = 0; j < blocks.length; j++) {
    var block = blocks[j];
    // A list item or quote holding paragraphs of its own is counted through them.
    if (block.querySelector('p') && block.tagName !== 'P') continue;
    var line = (block.innerText || '').replace(/\s+/g, ' ').trim();
    if (line) paragraphs.push(line);
  }
  var joined = paragraphs.join('\n\n');
  // A page with no paragraph markup at all: its visible text as it is.
  return joined || (root.innerText || '').trim();
}

var ExtensionPreprocessingJS = new FrankiGetPageText();
