let wordleState = {
    wordLength: 0,
    currentAttempt: 0,
    maxAttempts: 5,
    isGameOver: false
};

window.initWordleGame = function() {
    showScreen('wordle-screen');

    // Reset UI state
    document.getElementById('btn-submit-wordle').disabled = true;
    document.getElementById('btn-hint-wordle').disabled = true;
    document.getElementById('btn-roulette-wordle').disabled = true;
    document.getElementById('hint-display').innerHTML = "Selecione uma opção de dica abaixo.";
    document.getElementById('word-grid').innerHTML = '';
    document.getElementById('wordle-hidden-input').value = '';

    wordleState.currentAttempt = 0;
    wordleState.isGameOver = false;

    const theme = document.getElementById('theme-select').value;
    const difficulty = document.getElementById('difficulty-select').value;

    window.socket.emit('start_wordle_game', { theme, difficulty });
}

window.socket.on('wordle_game_started', ({ length }) => {
    wordleState.wordLength = length;

    // Enable buttons
    document.getElementById('btn-hint-wordle').disabled = false;
    document.getElementById('btn-roulette-wordle').disabled = false;

    // Setup Grid
    const gridElement = document.getElementById('word-grid');
    gridElement.style.gridTemplateColumns = `repeat(${length}, minmax(0, 1fr))`;

    for (let i = 0; i < wordleState.maxAttempts; i++) {
        for (let j = 0; j < length; j++) {
            const cell = document.createElement('div');
            cell.className = 'wordle-grid-cell aspect-square';
            cell.id = `wordle-cell-${i}-${j}`;
            cell.addEventListener('click', () => {
                 if(i === wordleState.currentAttempt) { focusWordleInput(); }
            });
            gridElement.appendChild(cell);
        }
    }

    focusWordleInput();
    updateWordleCursor();
});

// Event Listeners for Wordle
document.getElementById('wordle-hidden-input').addEventListener('input', handleWordleInput);
document.getElementById('btn-submit-wordle').addEventListener('click', submitWordleGuess);

document.getElementById('btn-hint-wordle').addEventListener('click', () => {
    window.socket.emit('wordle_request_hint');
});

document.getElementById('btn-roulette-wordle').addEventListener('click', () => {
    window.socket.emit('wordle_request_roulette');
});


function focusWordleInput() {
    if (wordleState.isGameOver) return;
    const input = document.getElementById('wordle-hidden-input');
    input.focus();
}

function handleWordleInput() {
    if (wordleState.isGameOver) {
        document.getElementById('wordle-hidden-input').value = '';
        return;
    }

    const input = document.getElementById('wordle-hidden-input');
    let currentWord = input.value.toUpperCase().normalize("NFD").replace(/[^A-Z]/g, "").substring(0, wordleState.wordLength);
    input.value = currentWord;

    // Update Grid
    for (let j = 0; j < wordleState.wordLength; j++) {
        const cell = document.getElementById(`wordle-cell-${wordleState.currentAttempt}-${j}`);
        if (!cell) continue;

        if (j < currentWord.length) {
            cell.textContent = currentWord[j];
        } else {
            cell.textContent = '';
        }
    }

    document.getElementById('btn-submit-wordle').disabled = currentWord.length !== wordleState.wordLength;
    updateWordleCursor();
}

function updateWordleCursor() {
    document.querySelectorAll('.wordle-grid-cell').forEach(cell => {
        cell.classList.remove('active-row-cursor');
    });

    if (!wordleState.isGameOver && wordleState.currentAttempt < wordleState.maxAttempts) {
        for(let j = 0; j < wordleState.wordLength; j++) {
            const cell = document.getElementById(`wordle-cell-${wordleState.currentAttempt}-${j}`);
            if(cell) {
                cell.classList.add('active-row-cursor');
            }
        }
    }
}

function getWordleGuess() {
    const input = document.getElementById('wordle-hidden-input');
    return input.value;
}

function submitWordleGuess() {
    if (wordleState.isGameOver) return;

    const guessedWord = getWordleGuess();
    if (guessedWord.length !== wordleState.wordLength) return;

    // Visual Shake
    const container = document.getElementById('wordle-game-container');
    container.classList.add('shake-animation');
    setTimeout(() => container.classList.remove('shake-animation'), 500);

    window.socket.emit('wordle_submit_guess', guessedWord);
}

window.socket.on('wordle_guess_result', ({ guessedWord, feedback, attemptIndex }) => {
    const cells = [];

    // Fill cell references
    for (let j = 0; j < wordleState.wordLength; j++) {
        const cell = document.getElementById(`wordle-cell-${attemptIndex}-${j}`);
        cells.push(cell);
    }

    // Apply feedback with animation
    for (let j = 0; j < wordleState.wordLength; j++) {
        const colorClass = feedback[j];
        setTimeout(() => {
            if (cells[j]) {
                cells[j].textContent = guessedWord[j]; // Ensure correct letter
                cells[j].classList.add(colorClass);
                cells[j].classList.remove('active-row-cursor');
            }
        }, j * 200);
    }

    // Reset Input for next attempt
    wordleState.currentAttempt++;
    document.getElementById('wordle-hidden-input').value = '';
    document.getElementById('btn-submit-wordle').disabled = true;

    if (!wordleState.isGameOver && wordleState.currentAttempt < wordleState.maxAttempts) {
        focusWordleInput();
        updateWordleCursor();
    }
});

window.socket.on('wordle_hint_response', ({ hint }) => {
    const hintDisplay = document.getElementById('hint-display');
    hintDisplay.innerHTML = `<i class="fas fa-comment text-kpop-rose mr-2"></i> ${hint}`;
    document.getElementById('btn-hint-wordle').disabled = true;
});

window.socket.on('wordle_roulette_response', ({ letters, message }) => {
    const hintDisplay = document.getElementById('hint-display');

    if (message === "zero") {
        hintDisplay.innerHTML = `<i class="fas fa-sad-tear text-red-500 mr-2"></i> Que pena! A roleta girou e revelou 0 letras. Tente de novo na próxima rodada!`;
    } else if (message === "all_revealed") {
        hintDisplay.innerHTML = `<i class="fas fa-check-circle text-green-500 mr-2"></i> Todas as letras únicas já foram reveladas ou adivinhadas!`;
    } else if (message === "success") {
         const revealedHtml = letters.map(l => `<span class="revealed-letter">${l}</span>`).join('');
         hintDisplay.innerHTML = `
            <i class="fas fa-star text-yellow-500 mr-2"></i> A roleta girou e revelou ${letters.length} letras:
            <span class="font-bold">${revealedHtml}</span>.
        `;
    }
    document.getElementById('btn-roulette-wordle').disabled = true;
});

window.socket.on('wordle_game_over', ({ win, secretWord }) => {
    wordleState.isGameOver = true;
    document.getElementById('btn-submit-wordle').disabled = true;
    document.getElementById('btn-hint-wordle').disabled = true;
    document.getElementById('btn-roulette-wordle').disabled = true;

    const modal = document.getElementById('wordle-modal');
    const modalTitle = document.getElementById('wordle-modal-title');
    const modalMessage = document.getElementById('wordle-modal-message');
    const modalSecretWord = document.getElementById('wordle-modal-secret-word');

    if (win) {
        modalTitle.textContent = "👑 DEBUT! Você Venceu! 💖";
        modalMessage.textContent = `Parabéns! Você ganhou 3 moedas!`;
        launchConfetti(5000);
    } else {
        modalTitle.textContent = "💔 Desbandou...";
        modalMessage.textContent = "Você perdeu 1 moeda (se tivesse). Tente novamente!";
    }

    modalSecretWord.textContent = secretWord;
    document.getElementById('wordle-hidden-input').blur();

    // Wait for animations to finish
    setTimeout(() => {
        modal.classList.remove('hidden');
    }, (wordleState.wordLength * 200) + 500);
});

window.closeWordleModal = function() {
    document.getElementById('wordle-modal').classList.add('hidden');
    showScreen('games-menu');
}

// Bind keydown globally for wordle input when screen is active
document.addEventListener('keydown', (event) => {
    const wordleScreen = document.getElementById('wordle-screen');
    if (!wordleScreen || wordleScreen.classList.contains('hidden')) return;

    if (event.key.toUpperCase() === 'ENTER') {
        submitWordleGuess();
    } else {
        // Focus input if typing letters
        focusWordleInput();
    }
});