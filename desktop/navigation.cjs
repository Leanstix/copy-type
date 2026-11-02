'use strict';
const MAX_INPUT=2048;
const SEARCH_BASE='https://www.google.com/search?q=';
const LOCALHOST=/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/|$)/i;
const DOMAIN=/^(?:(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.)+[a-z]{2,}(?::\d{1,5})?(?:[/?#]|$)/i;
const BLOCKED=/^(?:javascript|data|file|chrome|brave|devtools|about|blob|vbscript|ftp):/i;
function validateURL(url) {
 let u;try{u=new URL(url);}catch{throw Error('Enter a valid website URL.');}
 if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw Error('Only HTTP(S) addresses without credentials are supported.');
 return u.href;
}
function resolveInput(raw){
 if(typeof raw!=='string'||!raw.trim()||raw.length>MAX_INPUT)throw Error('Enter a search or website address (up to 2048 characters).');
 const value=raw.trim();
 if(BLOCKED.test(value)||/^\w+:\/\//.test(value)&&!/^https?:\/\//i.test(value))throw Error('This address type is not supported.');
 if(/^https?:\/\//i.test(value))return validateURL(value);
 if(LOCALHOST.test(value))return validateURL('http://'+value);
 if(DOMAIN.test(value)&&! /\s/.test(value))return validateURL('https://'+value);
 return SEARCH_BASE+encodeURIComponent(value);
}
module.exports={resolveInput,validateURL,MAX_INPUT,SEARCH_BASE};
