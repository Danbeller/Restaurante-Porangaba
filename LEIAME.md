# Sistema de Pedidos — Restaurante Porangaba
## Como usar

### Requisitos
- Python 3.7 ou superior (já vem instalado no Windows 10/11 via Microsoft Store, ou em https://python.org)

### Passo a passo

1. **Baixe os arquivos** na mesma pasta:
   - `server.py`
   - `index.html`
   - `styles.css`
   - `app.js`
   - Pasta `img/` com a logo (`img-1.jpeg`)

2. **Abra o terminal** na pasta onde estão os arquivos:
   - Windows: clique com botão direito na pasta → "Abrir no Terminal"
   - Mac/Linux: abra o Terminal e navegue até a pasta

3. **Inicie o servidor:**
   ```
   python3 server.py
   ```
   (No Windows pode ser `python server.py`)

4. **Acesse no navegador:**
   ```
   http://localhost:8080
   ```

5. **Pronto!** Funciona em qualquer navegador do mesmo computador (Chrome, Edge, Firefox, etc.)

---

### Credenciais do Admin
- Usuário: `danbeller088@gmail.com`
- Senha: `admin123`

> Acesse o painel admin clicando **3 vezes** na logo da tela de login.

### Banco de dados
- O arquivo `database.db` é criado automaticamente na mesma pasta
- Todos os dados ficam salvos nele permanentemente
- Para resetar tudo, basta apagar o arquivo `database.db`

### Estrutura dos arquivos
```
📁 minha-pasta/
├── server.py      ← Servidor Python + banco de dados SQLite
├── index.html     ← Páginas HTML (login, registro, dashboards)
├── styles.css     ← Visual com identidade do Restaurante Porangaba
├── app.js         ← Lógica do frontend
├── img/
│   └── img-1.jpeg ← Logo do restaurante
└── database.db    ← Criado automaticamente ao rodar
```
