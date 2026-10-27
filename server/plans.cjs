'use strict';
const scaleByKeyword = {
  'helyszínrajz':'M=1:200','alaprajza':'M=1:50','tető':'M=1:50',
  'metszet':'M=1:50','homlokzat':'M=1:50','idomterv':'M=1:500, 1:200',
  'geodézia':'M=1:200','tervezési':'M=1:200','konszignáció':'M=1:20, 1:50',
  'részlet':'M=1:5, 1:10','kerítés':'M=1:50'
};
const matchOrder = ['konszignáció','részlet','idomterv','helyszínrajz','geodézia',
  'tervezési','alaprajza','tető','metszet','homlokzat','kerítés'];
const normalized = text => String(text || '').toLowerCase().normalize('NFD')
  .replace(/[\u0300-\u036f]/g,'');
function planScale(title) {
  const name = normalized(title);
  const keyword = matchOrder.find(item => name.includes(normalized(item)));
  return keyword ? scaleByKeyword[keyword] : '';
}
module.exports = {planScale};
