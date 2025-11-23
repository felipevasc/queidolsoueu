const express = require('express');
const http = require('http');
const { Server } = require("socket.io");
const fs = require('fs-extra');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Configuração de arquivos estáticos
app.use(express.static('public'));
app.use('/personagens', express.static(path.join(__dirname, 'personagens')));

const DB_FILE = 'database.json';
const MOEDAS_VITORIA = 20;
const AVATAR_PRICES = { 1: 50, 2: 100, 3: 150, 4: 300, 5: 600 };

// Estado em Memória (Salas e Jogos)
let rooms = {}; // { roomId: { players: [], board: {}, turn: socketId } }

// --- FUNÇÕES AUXILIARES ---

// Carregar Banco de Dados
function loadDB() {
    if (!fs.existsSync(DB_FILE)) fs.writeJsonSync(DB_FILE, { users: [] });
    return fs.readJsonSync(DB_FILE);
}
function saveDB(data) { fs.writeJsonSync(DB_FILE, data); }

// Carregar Wordlists
function loadWordLists() {
    const wordlistsDir = path.join(__dirname, 'wordlists');
    if (!fs.existsSync(wordlistsDir)) return {};

    const files = fs.readdirSync(wordlistsDir).filter(f => f.endsWith('.json'));
    const wordData = {};

    files.forEach(f => {
        const theme = path.parse(f).name.toUpperCase();
        try {
            wordData[theme] = fs.readJsonSync(path.join(wordlistsDir, f));
        } catch(e) {
            console.error(`Error reading wordlist ${f}:`, e);
        }
    });

    // Create GERAL theme
    wordData['GERAL'] = [];
    Object.values(wordData).forEach(list => {
        wordData['GERAL'] = wordData['GERAL'].concat(list);
    });

    return wordData;
}

// Escanear Personagens nas pastas
function scanCharacters() {
    const basePath = path.join(__dirname, 'personagens', 'original');
    if (!fs.existsSync(basePath)) fs.ensureDirSync(basePath);
    
    const files = fs.readdirSync(basePath).filter(f => f.endsWith('.png') || f.endsWith('.jpg'));
    return files.map(f => {
        const name = path.parse(f).name;
        return { name: name, filename: f };
    });
}

// Verificar Inventário de Níveis
function getAvailableLevels(charName) {
    let levels = [0]; // 0 é original
    for (let i = 1; i <= 5; i++) {
        const lvlPath = path.join(__dirname, 'personagens', 'level', i.toString(), `${charName}.png`);
        if (fs.existsSync(lvlPath)) levels.push(i);
    }
    return levels;
}

// --- SOCKET.IO LÓGICA ---

io.on('connection', (socket) => {
    console.log('User connected:', socket.id);
    let currentUser = null;

    // 1. LOGIN / REGISTRO SIMPLIFICADO
    socket.on('login', ({ username, password }) => {
        const db = loadDB();
        let user = db.users.find(u => u.username === username);

        if (!user) {
            // Criar novo usuário
            user = { 
                username, password, coins: 0, 
                inventory: [], // Lista de {name, level} comprados
                avatar: { type: 'original', name: null } // Avatar atual
            };
            // Dar avatar default se houver personagens
            const chars = scanCharacters();
            if(chars.length > 0) user.avatar.name = chars[0].name;
            
            db.users.push(user);
            saveDB(db);
        } else {
            if (user.password !== password) {
                socket.emit('error_msg', 'Senha incorreta');
                return;
            }
        }
        
        currentUser = user;
        socket.join('lobby');
        socket.emit('login_success', user);
        io.to('lobby').emit('update_rooms', getPublicRooms());
    });

    // 2. DADOS DE SHOP E PERFIL
    socket.on('get_data', () => {
        if(!currentUser) return;
        const allChars = scanCharacters();
        // Enriquecer com info de níveis disponíveis no sistema
        const catalog = allChars.map(c => ({
            ...c,
            levelsAvailable: getAvailableLevels(c.name)
        }));
        socket.emit('update_data', { user: currentUser, catalog, prices: AVATAR_PRICES });
    });

    // 3. COMPRAR AVATAR
    socket.on('buy_avatar', ({ charName, level }) => {
        if (!currentUser) return;
        const db = loadDB();
        const userIndex = db.users.findIndex(u => u.username === currentUser.username);
        
        const cost = AVATAR_PRICES[level];
        if (db.users[userIndex].coins >= cost) {
            // Verifica se já tem
            const hasItem = db.users[userIndex].inventory.some(i => i.name === charName && i.level === level);
            if(!hasItem) {
                db.users[userIndex].coins -= cost;
                db.users[userIndex].inventory.push({ name: charName, level });
                saveDB(db);
                currentUser = db.users[userIndex];
                socket.emit('purchase_success', currentUser);
                socket.emit('update_data', { user: currentUser }); // Atualiza UI
            }
        } else {
            socket.emit('error_msg', 'Moedas insuficientes!');
        }
    });

    // 4. EQUIPAR AVATAR
    socket.on('equip_avatar', ({ charName, level }) => {
        if (!currentUser) return;
        const db = loadDB();
        const idx = db.users.findIndex(u => u.username === currentUser.username);
        db.users[idx].avatar = { name: charName, level: level || 0 };
        saveDB(db);
        currentUser = db.users[idx];
        socket.emit('update_data', { user: currentUser });
    });

    // 5. SISTEMA DE SALAS E JOGO
    socket.on('create_room', (roomName) => {
        const roomId = 'room_' + Math.random().toString(36).substr(2, 9);
        rooms[roomId] = {
            id: roomId,
            name: roomName,
            players: [{ id: socket.id, user: currentUser, ready: false }],
            state: 'waiting'
        };
        socket.join(roomId);
        socket.emit('room_joined', { roomId, isHost: true });
        io.to('lobby').emit('update_rooms', getPublicRooms());
    });

    socket.on('join_room', (roomId) => {
        if (rooms[roomId] && rooms[roomId].players.length < 2 && rooms[roomId].state === 'waiting') {
            // Adiciona o player com o objeto User completo (incluindo avatar atual)
            rooms[roomId].players.push({ id: socket.id, user: currentUser, ready: false });
            socket.join(roomId);
            
            // Envia confirmação para quem entrou (para setar currentRoomId no client)
            socket.emit('room_joined', { roomId });

            // Avisa quem entrou
            io.to(roomId).emit('room_update', rooms[roomId]); 
            
            // Iniciar Jogo se encheu
            if (rooms[roomId].players.length === 2) {
                startGame(roomId);
            }
        } else {
            socket.emit('error_msg', 'Sala cheia ou inexistente');
        }
    });

    socket.on('req_refresh_rooms', () => {
        socket.emit('update_rooms', getPublicRooms());
    });

    // --- WORDLE GAME LOGIC ---

    socket.on('start_wordle_game', ({ theme, difficulty }) => {
        const WORD_DATA = loadWordLists();

        // Helper to filter by length based on difficulty
        const getLengthFilter = (diff) => {
            switch (diff) {
                case 'FACIL': return (len) => len <= 4;
                case 'MEDIO': return (len) => len >= 4 && len <= 6;
                case 'DIFICIL': return (len) => len > 6;
                default: return (len) => len >= 4 && len <= 6;
            }
        };

        const lengthFilter = getLengthFilter(difficulty);
        const allWords = WORD_DATA[theme] || WORD_DATA['GERAL'];

        const availableWords = allWords.filter(item => {
            const len = item.word.normalize("NFD").replace(/[^a-zA-Z]/g, "").length;
            return lengthFilter(len);
        });

        // Fallback if no words found
        let selectedItem = { word: "MUNDO", hint: "Nosso lar." };

        if (availableWords.length > 0) {
            const randomIndex = Math.floor(Math.random() * availableWords.length);
            selectedItem = availableWords[randomIndex];
        }

        const normalizedWord = selectedItem.word.normalize("NFD").replace(/[^a-zA-Z]/g, "").toUpperCase();

        // Securely store game state in socket, do NOT send word to client
        socket.data.wordleSession = {
            word: normalizedWord,
            hint: selectedItem.hint,
            length: normalizedWord.length,
            attempts: 0,
            maxAttempts: 5,
            revealedLetters: []
        };

        socket.emit('wordle_game_started', {
            length: normalizedWord.length
        });
    });

    socket.on('wordle_submit_guess', (guess) => {
        if (!socket.data.wordleSession) return;
        const session = socket.data.wordleSession;
        const secretWord = session.word;
        const guessedWord = guess.toUpperCase().normalize("NFD").replace(/[^A-Z]/g, "").substring(0, session.length);

        if (guessedWord.length !== session.length) return;

        session.attempts++;

        // Validate Guess Logic (Matches the client logic)
        const feedback = new Array(session.length).fill('absent');
        const secretLetters = {};

        for (let char of secretWord) {
            secretLetters[char] = (secretLetters[char] || 0) + 1;
        }

        // Pass 1: Correct
        for (let i = 0; i < session.length; i++) {
            if (guessedWord[i] === secretWord[i]) {
                feedback[i] = 'correct';
                secretLetters[guessedWord[i]]--;
            }
        }

        // Pass 2: Present
        for (let i = 0; i < session.length; i++) {
            if (feedback[i] !== 'correct') {
                const letter = guessedWord[i];
                if (secretLetters[letter] > 0) {
                    feedback[i] = 'present';
                    secretLetters[letter]--;
                }
            }
        }

        socket.emit('wordle_guess_result', {
            guessedWord,
            feedback,
            attemptIndex: session.attempts - 1
        });

        // Check Win/Loss
        if (guessedWord === secretWord) {
            finishWordleGame(true);
        } else if (session.attempts >= session.maxAttempts) {
            finishWordleGame(false);
        }
    });

    socket.on('wordle_request_hint', () => {
        if (!socket.data.wordleSession) return;
        socket.emit('wordle_hint_response', { hint: socket.data.wordleSession.hint });
    });

    socket.on('wordle_request_roulette', () => {
        if (!socket.data.wordleSession) return;
        const session = socket.data.wordleSession;

        // Logic from original client code
        const revealCount = Math.floor(Math.random() * (session.length + 1));

        if (revealCount === 0) {
            socket.emit('wordle_roulette_response', { letters: [], message: "zero" });
            return;
        }

        const possibleLetters = Array.from(new Set(session.word.split('')))
            .filter(letter => !session.revealedLetters.includes(letter));

        if (possibleLetters.length === 0) {
            socket.emit('wordle_roulette_response', { letters: [], message: "all_revealed" });
            return;
        }

        let lettersToReveal = [];
        for (let i = 0; i < revealCount && possibleLetters.length > 0; i++) {
            const randomIndex = Math.floor(Math.random() * possibleLetters.length);
            const letter = possibleLetters.splice(randomIndex, 1)[0];
            lettersToReveal.push(letter);
            session.revealedLetters.push(letter);
        }

        socket.emit('wordle_roulette_response', { letters: lettersToReveal, message: "success" });
    });

    function finishWordleGame(win) {
        if (!currentUser || !socket.data.wordleSession) return;

        const db = loadDB();
        const idx = db.users.findIndex(u => u.username === currentUser.username);

        if (idx !== -1) {
            if (win) {
                db.users[idx].coins += 3;
            } else {
                db.users[idx].coins = Math.max(0, db.users[idx].coins - 1);
            }
            saveDB(db);
            currentUser = db.users[idx];
            socket.emit('update_data', { user: currentUser });
        }

        socket.emit('wordle_game_over', {
            win,
            secretWord: socket.data.wordleSession.word
        });

        // Clear session
        socket.data.wordleSession = null;
    }

    // Lógica de Jogo
    function startGame(roomId) {
        const room = rooms[roomId];
        const allChars = scanCharacters();
        
        if (allChars.length < 10) {
            io.to(roomId).emit('error_msg', 'Faltam personagens na pasta para jogar!');
            return;
        }

        const shuffled = allChars.sort(() => 0.5 - Math.random());
        const gameChars = shuffled.slice(0, 10);
        const p1Secret = gameChars[Math.floor(Math.random() * gameChars.length)];
        const p2Secret = gameChars[Math.floor(Math.random() * gameChars.length)];

        room.state = 'playing';
        
        // Mapeando dados dos jogadores para enviar ao frontend (nomes, avatares, etc)
        const p1Info = { id: room.players[0].id, name: room.players[0].user.username, avatar: room.players[0].user.avatar };
        const p2Info = { id: room.players[1].id, name: room.players[1].user.username, avatar: room.players[1].user.avatar };

        room.gameData = {
            characters: gameChars,
            p1: { ...p1Info, secret: p1Secret, eliminated: [] },
            p2: { ...p2Info, secret: p2Secret, eliminated: [] },
            turn: room.players[0].id
        };

        // Envia dados iniciais + Infos dos Players para montar o HUD corretamente
        io.to(roomId).emit('game_start', { 
            characters: gameChars,
            turn: room.gameData.turn,
            players: { p1: p1Info, p2: p2Info }
        });

        io.to(room.players[0].id).emit('your_secret', p1Secret);
        io.to(room.players[1].id).emit('your_secret', p2Secret);
    }

    socket.on('game_action_eliminate', ({ roomId, charName }) => {
        const room = rooms[roomId];
        // Verifica se a sala existe, está jogando, e se é a vez de quem clicou
        if (!room || room.state !== 'playing') return;
        if (room.gameData.turn !== socket.id) {
            console.log(`[Cheat?] User ${socket.id} tentou jogar fora de vez.`);
            return;
        }

        const isP1 = socket.id === room.gameData.p1.id;
        const playerData = isP1 ? room.gameData.p1 : room.gameData.p2;

        // Toggle eliminação
        if (playerData.eliminated.includes(charName)) {
            playerData.eliminated = playerData.eliminated.filter(n => n !== charName);
        } else {
            playerData.eliminated.push(charName);
        }
        
        console.log(`User ${socket.id} (P${isP1?1:2}) toggled ${charName}`);

        // Envia atualização APENAS para quem jogou (para virar a carta)
        socket.emit('update_board', { eliminated: playerData.eliminated });
        
        // Verifica vitória imediatamente ao derrubar
        checkWinCondition(roomId, socket.id);
    });

    function checkWinCondition(roomId, playerId) {
        const room = rooms[roomId];
        const isP1 = playerId === room.gameData.p1.id;
        const me = isP1 ? room.gameData.p1 : room.gameData.p2;
        const opponentSecret = isP1 ? room.gameData.p2.secret : room.gameData.p1.secret;

        // Personagens que NÃO foram eliminados pelo jogador
        const remaining = room.gameData.characters.filter(c => !me.eliminated.includes(c.name));

        // Condição: Sobrou apenas 1 personagem E ele é o segredo do oponente
        if (remaining.length === 1 && remaining[0].name === opponentSecret.name) {
            finishGame(roomId, playerId);
        }
        // Condição: Eliminou o segredo do oponente (DERROTA IMEDIATA)
        // Se o segredo do oponente NÃO está mais na lista de restantes, significa que foi eliminado.
        else if (!remaining.some(c => c.name === opponentSecret.name)) {
            // O jogador atual perdeu. O vencedor é o oponente.
            const winnerId = isP1 ? room.gameData.p2.id : room.gameData.p1.id;
            finishGame(roomId, winnerId);
        }
    }

    socket.on('game_finish_turn', ({ roomId }) => {
        const room = rooms[roomId];
        if (!room || room.state !== 'playing') return;
        if (room.gameData.turn !== socket.id) return;

        const nextTurn = (socket.id === room.gameData.p1.id) ? room.gameData.p2.id : room.gameData.p1.id;
        room.gameData.turn = nextTurn;
        
        console.log(`Turno trocado na sala ${roomId}. Agora é: ${nextTurn}`);
        io.to(roomId).emit('turn_change', { turn: nextTurn });
    });

    function finishGame(roomId, winnerId) {
        const room = rooms[roomId];
        if(!room || !room.gameData) return;

        room.state = 'finished';
        
        const winnerPlayer = room.players.find(p => p.id === winnerId);
        const loserPlayer = room.players.find(p => p.id !== winnerId);
        
        // Adicionar moedas
        const db = loadDB();
        const userIdx = db.users.findIndex(u => u.username === winnerPlayer.user.username);
        if (userIdx >= 0) {
            db.users[userIdx].coins += MOEDAS_VITORIA;
            saveDB(db);
        }

        // Descobrir segredos para revelar
        const p1Secret = room.gameData.p1.secret;
        const p2Secret = room.gameData.p2.secret;

        io.to(roomId).emit('game_over', { 
            winnerName: winnerPlayer.user.username,
            winnerId: winnerId,
            p1Secret: p1Secret,
            p2Secret: p2Secret,
            // Envia quem era o P1 e P2 para o cliente saber qual segredo mostrar pra quem
            p1Id: room.gameData.p1.id,
            p2Id: room.gameData.p2.id
        });

        setTimeout(() => {
            room.state = 'waiting';
            room.gameData = null;
            io.to(roomId).emit('room_reset', {});
        }, 25000); // Aumentei para 25s para dar tempo da festa
    }

    socket.on('disconnect', () => {
        // Remover de salas, etc. (Simplificado)
        for (const id in rooms) {
            rooms[id].players = rooms[id].players.filter(p => p.id !== socket.id);
            if (rooms[id].players.length === 0) delete rooms[id];
            else io.to(id).emit('player_left');
        }
        io.to('lobby').emit('update_rooms', getPublicRooms());
    });
});

function getPublicRooms() {
    return Object.values(rooms).map(r => ({ id: r.id, name: r.name, players: r.players.length }));
}

server.listen(3000, () => {
    console.log('Servidor rodando em http://localhost:3000');
});