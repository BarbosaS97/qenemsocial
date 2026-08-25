// QEnemSocial - atalho para abrir o painel admin (Ctrl+Alt+Shift+A)
//
// Isso é conveniência de navegação, NÃO é segurança: qualquer pessoa pode
// abrir este arquivo e descobrir o atalho. A proteção de verdade fica na
// Edge Function import-questions (checagem de ADMIN_SECRET no servidor).
//
// Incluído em index.html e estudar.html (não em admin.html) para valer em
// qualquer página do sistema, como pedido.
//
// Por que Ctrl+Alt+Shift+A: combinações com só dois modificadores (como o
// antigo Ctrl+Shift+3) esbarram fácil em atalhos já usados pelo Windows, por
// extensões de navegador ou por outros programas rodando em segundo plano.
// Exigir os três modificadores (Ctrl+Alt+Shift) ao mesmo tempo praticamente
// elimina esse risco de colisão — é uma combinação que nada mais costuma
// reivindicar. Se mesmo assim colidir com algo no seu Windows, me diga qual
// tecla prefere e eu troco.
(function () {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.altKey && e.shiftKey && e.code === "KeyA") {
      e.preventDefault();
      window.open("/admin.html", "_blank", "noopener");
    }
  });
})();
