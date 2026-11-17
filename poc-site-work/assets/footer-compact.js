(() => {
  const dialog=document.querySelector('#privacy-policy-preview');
  const trigger=document.querySelector('[data-privacy-open]');
  if(!dialog||!trigger)return;
  trigger.addEventListener('click',()=>dialog.showModal());
  dialog.querySelector('[data-privacy-close]').addEventListener('click',()=>dialog.close());
  dialog.addEventListener('click',event=>{if(event.target===dialog)dialog.close()});
})();
