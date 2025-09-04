const WebSocket = require('ws');
const { BotController } = require('./botController');
const uuid = require('uuid').v4;

const webSocketUrl = 'ws://171.251.51.213:5001';
const gameId = '0dbf8fc8-103e-4dbd-90b3-9d8873e275ed';
const teamId = '88b63d06-a620-44a1-9741-054e5bfd13ab';
const playerId = uuid();
const playerName = 'HuyHQ1';
const teamName = 'Fighters';

// gameID: 0dbf8fc8-103e-4dbd-90b3-9d8873e275ed
// Team 1: - Team 1 (ID: b5353aed-29bd-4226-b1e6-b440c5287d0e)
// Team 2: - Team 2 (ID: 88b63d06-a620-44a1-9741-054e5bfd13ab)

const botController = new BotController(playerId);

const ws = new WebSocket(webSocketUrl);

ws.onopen = () => {``
  console.log('[WebSocket] Connected to server');
  ws.send(JSON.stringify({
    type: 'join_game',
    data: { gameId, playerId, role: 'player', playerName, teamId, teamName }
  }));
};

ws.onclose = () => {
  console.warn('[WebSocket] Disconnected from server');
  botController.cleanup();
};

ws.onerror = (err) => {
  console.error('[WebSocket] Connection error:', err);
};

ws.onmessage = (event) => {
  try {
    const message = JSON.parse(event.data);

    if (isGameEventType(message.type)) {
      return processAndControl(message);
    }

    switch (message.type) {
      case 'join_success':
        console.log(`[WebSocket] Successfully joined game ${gameId}`);
        break;
      case 'game_over':
        console.log('[WebSocket] Game over. Winner:', message.winnerId);
        break;
    }
  } catch (error) {
    console.error('[WebSocket] Error processing message:', error);
  }
};


function isGameEventType(tag) {
  const gameEvents = ['tick', 'initial_state', 'tick_delta', 'bomb_placed', 'bomb_exploding_soon', 'player_died', 'game_over'];
  return gameEvents.includes(tag);
}

function sendControlAction(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[WebSocket] Cannot send action, connection is not open.');
    return;
  }

  try {
    ws.send(JSON.stringify({
      type: 'control',
      data: { action: action }
    }));
  } catch (error) {
    console.error('[WebSocket] Error sending action:', error);
  }
}

function sendControlGhostAction(action) {
  if (!ws || ws.readyState !== WebSocket.OPEN) {
    console.warn('[WebSocket] Cannot send ghost action, connection is not open.');
    return;
  }

  try {
    ws.send(JSON.stringify({
      type: 'control_ghost',
      data: { action: action }
    }));
  } catch (error) {
    console.error('[WebSocket] Error sending ghost action:', error);
  }
}

function processAndControl(gameState) {
  try {
    const action = botController.processGameState(gameState);
    
    if (action?.type === 'control') {
      sendControlAction(action.data);
    } else if (action?.type === 'control_ghost') {
      sendControlGhostAction(action.data);
    }
  } catch (error) {
    console.error('[Bot] Error processing game state:', error);
  }
}
