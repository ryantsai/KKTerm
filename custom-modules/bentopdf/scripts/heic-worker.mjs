import { runInNewContext } from 'node:vm';

const workerCall = /window\.__heic2any__worker=new Worker\(URL\.createObjectURL\([A-Za-z_$][\w$]*\)\)/g;
const blobStart = 'new Blob([`';
const blobEnd = '`],{type:`application/javascript`});';
const packagedWorkerUrl = '/dist/kkmod-runtime/heic2any/worker.js';

function removeDynamicFunctions(source) {
  const namedWrapper = /new Function\("body","return function "\+A\+'\(\) \{\\n {4}"use strict"; {4}return body\.apply\(this, arguments\);\\n\};\\n'\)\(e\)/g;
  const namedWrappers = [...source.matchAll(namedWrapper)];
  const dynCallWrapper = /A=function\(A\)\{for\(var e=\[\],r=1;r<f\.length;\+\+r\)e\.push\("a"\+r\);var i="return function "[\s\S]*?new Function\("dynCall","rawFunction",i\)\(A,n\)\}\(e\)/g;
  const dynCallWrappers = [...source.matchAll(dynCallWrapper)];
  const bindingWrapper = /function xe\(A,e,r,i,f\)\{[\s\S]*?\}function Pe\(/g;
  const bindingWrappers = [...source.matchAll(bindingWrapper)];
  if (namedWrappers.length !== 2 || dynCallWrappers.length !== 1 || bindingWrappers.length !== 1) {
    throw new Error(`Unexpected dynamic function wrappers in the heic2any worker (${namedWrappers.length} named, ${dynCallWrappers.length} dynCall, ${bindingWrappers.length} bindings).`);
  }

  const adapted = source
    .replace(namedWrapper, 'function(){"use strict";return e.apply(this,arguments)}')
    .replace(dynCallWrapper, 'A=function(A){return function(){return A(n,...arguments)}}(e)')
    .replace(bindingWrapper, `function xe(A,e,r,i,f){
      var count=e.length, hasThis=e[1]!==null&&r!==null;
      if(count<2)HA('argTypes array size mismatch! Must at least get return value and this types!');
      var useDestructors=e.slice(1).some(function(type){return type!==null&&type.destructorFunction===void 0});
      return function(){
        if(arguments.length!==count-2)HA('function '+A+' called with '+arguments.length+' arguments, expected '+(count-2)+' args!');
        var destructors=useDestructors?[]:null, wired=[f], converted=[];
        if(hasThis){var thisWired=e[1].toWireType(destructors,this);wired.push(thisWired)}
        for(var j=0;j<count-2;j++){var value=e[j+2].toWireType(destructors,arguments[j]);wired.push(value);converted.push(value)}
        var result=i.apply(null,wired);
        if(useDestructors)CA(destructors);
        else{
          if(hasThis&&e[1].destructorFunction)e[1].destructorFunction(thisWired);
          for(var j=0;j<converted.length;j++)if(e[j+2].destructorFunction)e[j+2].destructorFunction(converted[j]);
        }
        return e[0].name==='void'?void 0:e[0].fromWireType(result);
      }
    }function Pe(`);
  if (adapted.includes('new Function(') || adapted.includes('He(Function,')) {
    throw new Error('The heic2any worker still uses dynamic function creation.');
  }
  return adapted;
}

export function packageHeicWorker(source) {
  const calls = [...source.matchAll(workerCall)];
  if (calls.length !== 1) {
    throw new Error(`Expected one heic2any Blob worker call; found ${calls.length}.`);
  }

  const start = source.lastIndexOf(blobStart, calls[0].index);
  const end = source.indexOf(blobEnd, start);
  if (start < 0 || end < 0 || end > calls[0].index) {
    throw new Error('Could not locate the heic2any worker source.');
  }
  const literal = source.slice(start + 'new Blob(['.length, end + 1);
  if (literal.includes('${')) {
    throw new Error('Unexpected interpolation in the heic2any worker source.');
  }
  const workerSource = runInNewContext(literal, {}, { timeout: 1000 });
  if (typeof workerSource !== 'string' || !workerSource.trim()) {
    throw new Error('The heic2any worker source is empty.');
  }

  return {
    bundle: source.replace(workerCall, `window.__heic2any__worker=new Worker('${packagedWorkerUrl}')`),
    workerSource: removeDynamicFunctions(workerSource),
  };
}
