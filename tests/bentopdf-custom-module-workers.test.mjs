import assert from 'node:assert/strict';
import test from 'node:test';

import { packageHeicWorker } from '../custom-modules/bentopdf/scripts/heic-worker.mjs';

test('BentoPDF packages the HEIC worker without Blob URLs or dynamic code', () => {
  const worker = `
    function QA(A,e){return A=YA(A),new Function("body","return function "+A+'() {\\\\n    "use strict";    return body.apply(this, arguments);\\\\n};\\\\n')(e)}
    A=function(A){for(var e=[],r=1;r<f.length;++r)e.push("a"+r);var i="return function "+f;return new Function("dynCall","rawFunction",i)(A,n)}(e);
    function xe(A,e,r,i,f){return He(Function,d).apply(null,k)}function Pe(){}
    function QA(A,e){return A=YA(A=A||"function_"+new Date),new Function("body","return function "+A+'() {\\\\n    "use strict";    return body.apply(this, arguments);\\\\n};\\\\n')(e)}
    self.onmessage=()=>postMessage("ready");`;
  const bundle = `var e=new Blob([\`${worker}\`],{type:\`application/javascript\`});window.__heic2any__worker=new Worker(URL.createObjectURL(e));`;
  const result = packageHeicWorker(bundle);

  assert.match(result.workerSource, /postMessage\("ready"\)/);
  assert.doesNotMatch(result.workerSource, /new Function\(|He\(Function,/);
  assert.match(result.bundle, /new Worker\('\/dist\/kkmod-runtime\/heic2any\/worker\.js'\)/);
  assert.doesNotMatch(result.bundle, /new Worker\(URL\.createObjectURL/);
});

test('BentoPDF packaging rejects a changed HEIC worker shape', () => {
  assert.throws(() => packageHeicWorker('new Worker(URL.createObjectURL(blob))'));
});
