import test from 'node:test'
import assert from 'node:assert/strict'
import {findSelectedCells,validateRecognizedNumbers} from '../src/services/selected-cells.js'
function fixture(numbers, offset=20) {
 const width=1000,height=500,data=new Uint8ClampedArray(width*height*4)
 for(const n of numbers){const left=offset+((n-1)%10)*30,top=20+Math.floor((n-1)/10)*30;for(let y=top;y<top+26;y++)for(let x=left;x<left+26;x++){const i=(y*width+x)*4;data[i]=10;data[i+1]=70;data[i+2]=245;data[i+3]=255}}
 return {width,height,data}
}
const numbers=[2,11,28,29,40,52,53,59,62,72]
test('finds the selected ten cells and excludes screen text',()=>{const r=findSelectedCells(fixture(numbers));assert.equal(r.cells.length,10);assert.equal(r.reason,'')})
test('does not turn nine or eleven cells into ten',()=>{for(const v of [numbers.slice(1),[...numbers,80]])assert.notEqual(findSelectedCells(fixture(v)).reason,'')})
test('does not combine two separate tickets',()=>{const a=fixture(numbers),b=fixture(numbers,600);for(let i=0;i<a.data.length;i++)a.data[i]=Math.max(a.data[i],b.data[i]);assert.equal(findSelectedCells(a).cells.length,0)})
test('does not invent numbers on a blank image',()=>assert.equal(findSelectedCells(fixture([])).cells.length,0))
test('accepts only ten distinct integer numbers in 1..80',()=>{assert.equal(validateRecognizedNumbers(numbers).ok,true);for(const v of [numbers.slice(1),[...numbers,80],[...numbers.slice(1),11],[0,...numbers.slice(1)],[81,...numbers.slice(1)],[NaN,...numbers.slice(1)],['2',...numbers.slice(1)]])assert.equal(validateRecognizedNumbers(v).ok,false)})
