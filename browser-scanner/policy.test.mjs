import test from 'node:test';
import assert from 'node:assert/strict';
import {pageURL,allowedRequest,publicIPv4} from './policy.mjs';
test('scanner rejects private addresses and off-scope navigations',()=>{
 for(const ip of ['127.0.0.1','10.1.2.3','172.18.0.2','192.168.0.1','169.254.169.254','::1','100.64.0.1'])assert.equal(publicIPv4(ip),false);
 assert.equal(publicIPv4('1.1.1.1'),true);
 for(const u of ['http://dev.libretexts.org/Sandboxes/johnnyphung/a','https://dev.libretexts.org/Sandboxes/other/a','https://evil.test/Sandboxes/johnnyphung','https://dev.libretexts.org:8443/Sandboxes/johnnyphung','https://user:pass@dev.libretexts.org/Sandboxes/johnnyphung'])assert.throws(()=>pageURL(u));
 assert.equal(allowedRequest('https://dev.libretexts.org/a',new Set(['dev.libretexts.org']),'POST'),false);
});
