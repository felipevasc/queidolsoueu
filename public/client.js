const socket = io();

// ESTADOS GLOBAIS
let currentUser = null;
let currentRoomId = null;
let isMyTurn = false;

// --- UTILS ---
function getAvatarUrl(avatarObj) {
    if (!avatarObj || !avatarObj.name) return 'https://via.placeholder.com/150';
    const level = avatarObj.level || 0;
    const folder = level === 0 ? 'original' : `level/${level}`;
    return `/personagens/${folder}/${encodeURIComponent(avatarObj.name)}.png`;
}

function showScreen(screenId) {
    document.querySelectorAll('section').forEach(el => el.classList.add('hidden'));
    const screen = document.getElementById(screenId);
    if(screen) screen.classList.remove('hidden');
}

// --- AUTH ---
function login() {
    const user = document.getElementById('username').value;
    const pass = document.getElementById('password').value;
    if(user && pass) socket.emit('login', { username: user, password: pass });
}

socket.on('login_success', (user) => {
    currentUser = user;
    updateLobbyHeader();
    showScreen('main-menu');
    refreshRooms(); // Já carrega as salas ao logar
});

socket.on('error_msg', (msg) => alert(msg));

function updateLobbyHeader() {
    document.getElementById('display-username').innerText = currentUser.username;
    document.getElementById('display-coins').innerText = currentUser.coins;
    document.getElementById('my-avatar-display').style.backgroundImage = `url('${getAvatarUrl(currentUser.avatar)}')`;
}

// --- MENU & LOJA ---
// Correção do erro ReferenceError
window.refreshRooms = function() {
    socket.emit('req_refresh_rooms');
}

window.openSettings = function() {
    showScreen('collection-screen');
    fetchShopData();
}

function fetchShopData() { socket.emit('get_data'); }
function createRoom() { socket.emit('create_room', `Sala de ${currentUser.username}`); }
function joinRoom(id) { socket.emit('join_room', id); }

// Recebe a lista de salas
socket.on('update_rooms', (rooms) => {
    const list = document.getElementById('rooms-list');
    list.innerHTML = '';
    if(rooms.length === 0) list.innerHTML = '<p style="text-align:center; color:#888">Nenhuma sala aberta.</p>';
    
    rooms.forEach(r => {
        list.innerHTML += `
        <div style="background:white; padding:15px; margin:10px 0; border-radius:15px; display:flex; justify-content:space-between; align-items:center; box-shadow:0 2px 5px rgba(0,0,0,0.05)">
            <div>
                <strong>${r.name}</strong><br>
                <small>${r.players}/2 Jogadores</small>
            </div>
            <button onclick="joinRoom('${r.id}')" style="background:var(--pink-main); color:white; padding:8px 15px; font-size:0.8rem">Entrar</button>
        </div>`;
    });
});

socket.on('room_joined', ({ roomId }) => {
    currentRoomId = roomId;
    showScreen('waiting-room');
});

// --- LOJA LÓGICA (Simplificada para não ocupar espaço, mantenha a anterior se tiver) ---
socket.on('update_data', (data) => {
    // Mesma lógica da resposta anterior (Shop/Collection)
    if(data.user) { currentUser = data.user; updateLobbyHeader(); }
    if(data.catalog) { renderShop(data.catalog, data.prices); renderCollection(data.catalog); }
});
function renderShop(catalog, prices) {
    const grid = document.getElementById('shop-grid');
    grid.innerHTML = '';
    let hasItems = false;

    catalog.forEach(char => {
        // Show all levels 1-5
        for(let lvl=1; lvl<=5; lvl++) {
            // Check availability (if the file exists on server)
            if(!char.levelsAvailable.includes(lvl)) continue;
            hasItems = true;

            // Check if user owns it
            const owned = currentUser.inventory.some(i => i.name === char.name && i.level === lvl);

            const div = document.createElement('div');
            div.className = 'shop-card';
            // if(!owned) div.className += ' locked'; // Shop items don't need to look locked, just the ones in collection

            const price = prices[lvl];
            const imgUrl = `/personagens/level/${lvl}/${encodeURIComponent(char.name)}.png`;

            div.innerHTML = `
                <img src="${imgUrl}">
                <div style="margin-top:5px">
                    <strong>${char.name} (Lvl ${lvl})</strong><br>
                    <span>💰 ${price}</span>
                </div>
                <button onclick="buyItem('${char.name}', ${lvl})" ${owned ? 'disabled' : ''} style="margin-top:5px; font-size:0.8rem; padding:5px 10px; background:${owned ? '#ccc' : 'var(--pink-main)'}; color:white">
                    ${owned ? 'Comprado' : 'Comprar'}
                </button>
            `;
            grid.appendChild(div);
        }
    });

    if(!hasItems) {
        grid.innerHTML = '<p style="text-align:center; grid-column: 1 / -1; color:#666;">Nenhum item disponível na loja no momento. Peça ao admin para adicionar imagens nas pastas de nível!</p>';
    }
}

function renderCollection(catalog) {
    const grid = document.getElementById('collection-grid');
    grid.innerHTML = '';

    // Group by levels
    for(let lvl=0; lvl<=5; lvl++) {
        // Check if there are any items for this level (either original or available levels)
        const itemsInLevel = catalog.filter(char => lvl === 0 || char.levelsAvailable.includes(lvl));

        if(itemsInLevel.length === 0) continue;

        // Create Header
        const header = document.createElement('h3');
        header.style.gridColumn = "1 / -1";
        header.style.marginTop = "20px";
        header.style.color = "var(--pink-dark)";
        header.innerText = lvl === 0 ? "Nível Original" : `Nível ${lvl}`;
        grid.appendChild(header);

        // Render Items
        itemsInLevel.forEach(char => {
            const owned = lvl === 0 ? true : currentUser.inventory.some(i => i.name === char.name && i.level === lvl);
            createCollectionCard(grid, char.name, lvl, owned);
        });
    }
}

function createCollectionCard(grid, name, level, owned) {
    const div = document.createElement('div');
    div.className = 'collection-card';
    if(!owned) div.className += ' dimmed'; // Add dimmed class if not owned

    const isEquipped = (currentUser.avatar.name === name && (currentUser.avatar.level || 0) === level);
    const folder = level === 0 ? 'original' : `level/${level}`;
    const imgUrl = `/personagens/${folder}/${encodeURIComponent(name)}.png`;

    div.innerHTML = `
        <img src="${imgUrl}">
        <div style="margin-top:5px">
            <strong>${name} ${level>0 ? 'Lvl '+level : ''}</strong>
        </div>
        ${owned ?
            `<button onclick="equip('${name}', ${level})" ${isEquipped ? 'disabled' : ''} style="margin-top:5px; font-size:0.8rem; padding:5px 10px; background:var(--pink-dark); color:white">
                ${isEquipped ? 'Em uso' : 'Usar'}
            </button>`
            :
            `<button disabled style="margin-top:5px; font-size:0.8rem; padding:5px 10px; background:#ccc; color:white">
                🔒 Bloqueado
            </button>`
        }
    `;
    grid.appendChild(div);
}

function buyItem(n, l) { socket.emit('buy_avatar', { charName: n, level: l }); }
function equip(n, l) { socket.emit('equip_avatar', { charName: n, level: l }); }


// ========================================================
// === LÓGICA DO JOGO ===
// ========================================================

socket.on('game_start', (data) => {
    console.log("Jogo começou!", data);
    showScreen('game-screen');
    
    setupBoard(data.characters);
    
    const amIP1 = (socket.id === data.players.p1.id);
    const myData = amIP1 ? data.players.p1 : data.players.p2;
    const oppData = amIP1 ? data.players.p2 : data.players.p1;

    // Preenche HUD
    document.getElementById('my-game-name').innerText = "Eu";
    document.getElementById('my-game-avatar').src = getAvatarUrl(myData.avatar);
    document.getElementById('my-score').innerText = "0";

    document.getElementById('opp-name').innerText = oppData.name;
    document.getElementById('opp-avatar').src = getAvatarUrl(oppData.avatar);
    document.getElementById('opp-score').innerText = "0";

    handleTurn(data.turn);
});

socket.on('your_secret', (char) => {
    document.getElementById('my-secret-card').src = `/personagens/original/${encodeURIComponent(char.name)}.png`;
    document.getElementById('my-secret-name').innerText = char.name;
});

function setupBoard(characters) {
    const board = document.getElementById('game-board');
    board.innerHTML = '';
    characters.forEach(c => {
        const div = document.createElement('div');
        div.className = 'game-card';
        div.id = `card-${c.name}`; // ID único para manipular
        // Importante: Passamos o nome como string
        div.onclick = function() { toggleCard(c.name); };
        
        div.innerHTML = `
            <div class="card-inner">
                <div class="card-front">
                    <img src="/personagens/original/${encodeURIComponent(c.name)}.png">
                    <div class="name-tag">${c.name}</div>
                </div>
                <div class="card-back">✖</div>
            </div>
        `;
        board.appendChild(div);
    });
}

function toggleCard(charName) {
    console.log("Tentando derrubar:", charName, "| É minha vez?", isMyTurn);
    
    if(!isMyTurn) {
        // Feedback visual se tentar clicar fora da vez
        const btn = document.getElementById('finish-turn-btn');
        btn.style.backgroundColor = 'red';
        setTimeout(() => btn.style.backgroundColor = 'var(--pink-main)', 200);
        return;
    }
    
    socket.emit('game_action_eliminate', { roomId: currentRoomId, charName: charName });
}

socket.on('update_board', ({ eliminated }) => {
    console.log("Atualizando tabuleiro:", eliminated);
    
    // Atualiza Placar do Jogador atual
    document.getElementById('my-score').innerText = eliminated.length;

    // Vira as cartas visualmente
    const allCards = document.querySelectorAll('.game-card');
    allCards.forEach(card => {
        const name = card.id.replace('card-', '');
        if(eliminated.includes(name)) {
            card.classList.add('knocked-down');
        } else {
            card.classList.remove('knocked-down');
        }
    });
});

// Ação do botão "Confirmar Jogada"
window.finishTurn = function() {
    if(isMyTurn) {
        socket.emit('game_finish_turn', { roomId: currentRoomId });
    }
}

socket.on('turn_change', ({ turn }) => {
    console.log("Turno mudou para:", turn);
    handleTurn(turn);
});

function handleTurn(turnId) {
    isMyTurn = (turnId === socket.id);
    const body = document.body;
    const btn = document.getElementById('finish-turn-btn');
    const oppMsg = document.getElementById('turn-msg');

    if(isMyTurn) {
        body.classList.add('my-turn');
        body.classList.remove('opponent-turn');
        btn.disabled = false;
        btn.innerText = "✅ Confirmar Jogada";
        oppMsg.innerText = "Sua vez! Derrube cartas.";
        
        // CORREÇÃO CRÍTICA: Ao começar meu turno, garanta que o tabuleiro
        // mostre MINHAS eliminações (pode ser que estivesse mostrando nada antes)
        // O servidor manda update_board ao clicar, mas podemos forçar um sync se necessário.
    } else {
        body.classList.remove('my-turn');
        body.classList.add('opponent-turn');
        btn.disabled = true;
        btn.innerText = "⏳ Aguarde...";
        oppMsg.innerText = "Oponente está jogando...";
    }
}

// --- FIM DE JOGO ---
socket.on('game_over', (data) => {
    document.getElementById('win-overlay').classList.remove('hidden');
    
    const amIP1 = (socket.id === data.p1Id);
    const amIWinner = (data.winnerId === socket.id);
    
    document.getElementById('win-title').innerText = amIWinner ? "🎉 PARABÉNS! 🎉" : "💔 QUE PENA!";
    document.getElementById('winner-announce').innerText = `Vencedor: ${data.winnerName}`;
    document.getElementById('coins-msg').innerText = amIWinner ? "+20 Moedas!" : "+0 Moedas";

    // Mostra quem era quem
    // O Vencedor sempre será exibido no card de vencedor
    let winnerChar, loserChar;
    
    if (data.winnerId === data.p1Id) {
        winnerChar = data.p1Secret; // O segredo do P1 (vencedor)
        loserChar = data.p2Secret;  // O segredo do P2 (perdedor)
    } else {
        winnerChar = data.p2Secret;
        loserChar = data.p1Secret;
    }

    document.getElementById('reveal-winner-img').src = `/personagens/original/${encodeURIComponent(winnerChar.name)}.png`;
    document.getElementById('reveal-winner-name').innerText = winnerChar.name;

    document.getElementById('reveal-loser-img').src = `/personagens/original/${encodeURIComponent(loserChar.name)}.png`;
    document.getElementById('reveal-loser-name').innerText = loserChar.name;

    // Confetes por 20 segundos
    if(amIWinner) launchConfetti(20000);
});

window.resetToLobby = function() {
    document.getElementById('win-overlay').classList.add('hidden');
    showScreen('lobby-screen');
    refreshRooms();
}

function launchConfetti(duration) {
    var end = Date.now() + duration;
    (function frame() {
        confetti({ particleCount: 5, angle: 60, spread: 55, origin: { x: 0 } });
        confetti({ particleCount: 5, angle: 120, spread: 55, origin: { x: 1 } });
        if (Date.now() < end) requestAnimationFrame(frame);
    }());
}