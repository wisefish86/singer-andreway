// Read-only probe for the deployed Google Apps Script reviews endpoint.
// Never print review texts, names, or private spreadsheet values.
const origin='https://script.google.com/macros/s/AKfycbzCtHUBRaC3c_Tovx6We58tVElMRn1w6FUkcLCdNZAVhDyLnVj8hut-_gKTXgov086tlg/exec';
const controller=new AbortController();
const timer=setTimeout(()=>controller.abort(),16000);
try{
 const response=await fetch(origin+'?kind=reviews',{signal:controller.signal,redirect:'follow',headers:{accept:'application/json'}});
 if(!response.ok)throw new Error('Reviews API returned HTTP '+response.status);
 const data=await response.json();
 if(!Array.isArray(data?.reviews))throw new Error('Reviews API does not return a reviews array');
 for(const review of data.reviews){
  if(typeof review.author!=='string'||typeof review.text!=='string')throw new Error('Reviews schema invalid');
  if('source' in review||'consent' in review)throw new Error('Private review metadata leaked');
 }
 console.log('Reviews public API validated: HTTP '+response.status+'; entries='+data.reviews.length);
}finally{clearTimeout(timer)}
