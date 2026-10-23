/* Focused regression checks for the exact shared library built for Office. */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <libxml/parser.h>
#include <libxml/tree.h>
#include <libxml/dict.h>
#include <libxml/uri.h>
#include <libxml/xinclude.h>
#include <libxml/xpointer.h>
#include <libxml/xmlIO.h>

static unsigned long written;
static int loads;
static xmlParserInputPtr blocked_loader(const char *url, const char *id, xmlParserCtxtPtr ctxt) {
    (void)id;
    assert(url && strstr(url, "http://example.invalid/") == url);
    assert(ctxt && (ctxt->options & XML_PARSE_NONET));
    ++loads;
    return NULL;
}
static int writer(void *ctx, const char *data, int len) {
    (void)ctx;
    assert(data && len >= 0);
    written += len;
    return len;
}
int main(void) {
    xmlCheckVersion(LIBXML_VERSION);
    assert(!strcmp(xmlParserVersion, "20914"));
    const char *xml = "<!DOCTYPE root [<!ENTITY word 'safe entity'>]><root><p>&word;</p></root>";
    xmlDocPtr doc = xmlReadMemory(xml, strlen(xml), "fixture.xml", NULL, XML_PARSE_NONET | XML_PARSE_NOENT);
    assert(doc);
    xmlChar *text = xmlNodeGetContent(xmlDocGetRootElement(doc));
    assert(!xmlStrcmp(text, BAD_CAST "safe entity")); xmlFree(text);
    xmlXPathContextPtr xp = xmlXPtrNewContext(doc, NULL, NULL);
    xmlXPathObjectPtr value = xmlXPtrEval(BAD_CAST "xpointer(/root/p)", xp);
    assert(value && value->nodesetval && value->nodesetval->nodeNr == 1);
    xmlXPathFreeObject(value); xmlXPathFreeContext(xp); xmlFreeDoc(doc);
    xmlDictPtr dict = xmlDictCreate();
    assert(dict && xmlDictQLookup(dict, BAD_CAST "prefix", BAD_CAST "entry")); xmlDictFree(dict);
    text = xmlURIEscapeStr(BAD_CAST "space & value", NULL);
    assert(text && strstr((char*)text, "%20") && strstr((char*)text, "%26")); xmlFree(text);
    for (int tree = 0; tree < 2; ++tree) for (int as_text = 0; as_text < 2; ++as_text) {
        char include[512];
        snprintf(include, sizeof include, "<root xmlns:xi='http://www.w3.org/2001/XInclude'><xi:include href='http://example.invalid/file' parse='%s'><xi:fallback>blocked</xi:fallback></xi:include></root>", as_text ? "text" : "xml");
        doc = xmlReadMemory(include, strlen(include), "fixture.xml", NULL, XML_PARSE_NONET);
        assert(doc); xmlSetExternalEntityLoader(blocked_loader);
        assert((tree ? xmlXIncludeProcessTree(xmlDocGetRootElement(doc)) : xmlXIncludeProcess(doc)) >= 0);
        text = xmlNodeGetContent(xmlDocGetRootElement(doc));
        assert(text && strstr((char*)text, "blocked")); xmlFree(text); xmlFreeDoc(doc);
    }
    assert(loads == 4); xmlSetExternalEntityLoader(xmlNoNetExternalEntityLoader);
    xmlOutputBufferPtr out = xmlOutputBufferCreateIO(writer, NULL, NULL, NULL);
    assert(out); char block[4096]; memset(block, 'a', sizeof block);
    for (int i = 0; i < 1024; ++i) assert(xmlOutputBufferWrite(out, sizeof block, block) >= 0);
    assert(xmlOutputBufferClose(out) >= 0); assert(written == 4096UL * 1024);
    xmlCleanupParser();
    puts("libxml2 entity, dictionary, URI, XPointer, output and NONET/XInclude regressions passed");
    return 0;
}
