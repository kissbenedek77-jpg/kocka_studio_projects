'use strict';
document.addEventListener('DOMContentLoaded',()=>{
  const drawer=document.getElementById('stepDrawer');
  if(!drawer?.classList.contains('offcanvas-lg')||!window.bootstrap?.Offcanvas)return;
  drawer.addEventListener('click',event=>{
    if(!event.target.closest('.step-item')||window.innerWidth>=992)return;
    window.bootstrap.Offcanvas.getOrCreateInstance(drawer).hide();
  });
});
