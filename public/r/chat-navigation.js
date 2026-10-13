(() => {
  const button = document.getElementById('chat-menu-button');
  const navigation = document.getElementById('chat-site-nav');
  const close = () => { navigation.classList.remove('is-open'); button.setAttribute('aria-expanded','false'); };
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    navigation.classList.toggle('is-open',open); button.setAttribute('aria-expanded',String(open));
  });
  navigation.addEventListener('click',event => { if(event.target.closest('a')) close(); });
  document.addEventListener('keydown',event => { if(event.key === 'Escape' && navigation.classList.contains('is-open')) { close(); button.focus(); } });
})();
