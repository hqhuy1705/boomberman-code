const TileType = {
  EMPTY: 0,
  BRICK: 2,
  WALL: 1,
};

class BotController {
  playerId = '';
  lastKnownState = {
    map: null,
    players: new Map(),
    bombs: [],
    items: [],
  };
  justPlacedBomb = false;  // Thêm biến theo dõi trạng thái đặt bom

  constructor(playerId) {
    this.playerId = playerId;
    this.lastPosition = null; // Thêm biến theo dõi vị trí trước đó
    this.stuckCounter = 0;    // Đếm số lần ở một vị trí
    this.lastMove = null;     // Lưu nước đi trước đó
  }

  _handleInitialState(data) {
    this.lastKnownState.map = data.map;

    console.log('Initial map size:', this.lastKnownState.map.width, 'x', this.lastKnownState.map.height);

    this.lastKnownState.players.clear();
    if (data.players && Array.isArray(data.players)) {
      data.players.forEach(player => {
        this.lastKnownState.players.set(player.id, player);
      });
    }

    this.lastKnownState.bombs = data.bombs || [];
    this.lastKnownState.items = data.items || [];

    console.log('Initial players:', Array.from(this.lastKnownState.players.values()).map(p => p.name).join(', '));
    console.log('Initial bombs:', this.lastKnownState.bombs.length);
    console.log('Initial items:', this.lastKnownState.items.length);
  }

  _handleTickDelta(delta) {
    if (delta.destroyedBricks && Array.isArray(delta.destroyedBricks)) {
      delta.destroyedBricks.forEach(brick => {
        if (this.lastKnownState.map && this.lastKnownState.map.tiles) {
          this.lastKnownState.map.tiles[brick.y][brick.x] = TileType.EMPTY;
        }
      });
    }

    if (delta.players && Array.isArray(delta.players)) {
      delta.players.forEach(playerPayload => {
        const existingPlayer = this.lastKnownState.players.get(playerPayload.id);
        if (existingPlayer) {
          const updatedPlayer = this._hydratePlayer(playerPayload, existingPlayer);
          this.lastKnownState.players.set(playerPayload.id, updatedPlayer);
        } else {
          const newPlayer = this._hydratePlayer(playerPayload, {});
          this.lastKnownState.players.set(playerPayload.id, newPlayer);
        }
      });
    }

    if (delta.bombs && Array.isArray(delta.bombs)) {
      this.lastKnownState.bombs = delta.bombs.map(bombPayload => this._hydrateBomb(bombPayload));
    }

    if (delta.items && Array.isArray(delta.items)) {
      this.lastKnownState.items = delta.items.map(itemPayload => this._hydrateItem(itemPayload));
    }
  }

  _hydratePlayer(payload, baseObj) {
    const player = { ...baseObj };

    if (payload.id !== undefined) player.id = payload.id;
    if (payload.n !== undefined) player.name = payload.n;
    if (payload.d !== undefined) player.direction = payload.d;
    if (payload.p !== undefined) {
      player.position = {
        x: payload.p.x / 100.0,
        y: payload.p.y / 100.0,
      };
    }
    if (payload.s !== undefined) player.status = payload.s;
    if (payload.iv !== undefined) player.isInvincible = payload.iv;
    if (payload.ivt !== undefined) player.invincibilityTicksLeft = payload.ivt;
    if (payload.sp !== undefined) player.speed = payload.sp;
    if (payload.bl !== undefined) player.bombLimit = payload.bl;
    if (payload.bp !== undefined) player.bombsPlaced = payload.bp;
    if (payload.pow !== undefined) player.bombPower = payload.pow;
    if (payload.sc !== undefined) player.score = payload.sc;
    if (payload.tid !== undefined) player.teamId = payload.tid;

    return player;
  }

  _hydrateBomb(payload) {
    return {
      id: payload.id,
      ownerId: payload.o,
      position: { x: payload.p.x, y: payload.p.y },
      countdownTicks: payload.c,
      power: payload.pow,
      isExplodingSoon: payload.es,
      isMoving: payload.imv,
      kickerId: payload.kid,
      moveDirection: payload.md,
      moveDistanceLeft: payload.mdl,
    };
  }

  _hydrateItem(payload) {
    return {
      id: payload.id,
      type: payload.t,
      position: { x: payload.p.x, y: payload.p.y },
    };
  }

  processGameState(serverData) {
    if (!serverData || !serverData.type) return null;

    try {
      if (serverData.type === 'initial_state') {
        this._handleInitialState(serverData);
      } else if (serverData.type === 'tick_delta') {
        this._handleTickDelta(serverData);
      }

      const players = Array.from(this.lastKnownState.players.values());
      const botState = players.find(p => p.id === this.playerId);

      if (botState.status === 'dead') {
        return this.decideGhostAction();
      } else {
        const action = this.decideNextAction();

        return { type: 'control', data: action };
      }
    } catch (e) {
      console.error(`Error processing server data`, e);
      return null;
    }
  }

  decideGhostAction() {
    // Send ghost action
    return {
      type: 'control_ghost',
      data: {
        x: 5,
        y: 7,
      },
    };
  }

  _findNearestBrick(position) {
    let nearest = null;
    let minDistance = Infinity;
    
    if (!this.lastKnownState.map || !this.lastKnownState.map.tiles) return null;
    
    const tiles = this.lastKnownState.map.tiles;
    for (let y = 0; y < tiles.length; y++) {
      for (let x = 0; x < tiles[y].length; x++) {
        if (tiles[y][x] === TileType.BRICK) {
          const distance = this._getDistance(position, {x, y});
          if (distance < minDistance) {
            minDistance = distance;
            nearest = {x, y};
          }
        }
      }
    }
    return nearest;
  }

  _isBlocked(position) {
    return !this._isValidMove(position);
  }

  _isWall(position) {
    if (!this.lastKnownState.map || !this.lastKnownState.map.tiles) return true;
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    return this.lastKnownState.map.tiles[y][x] === TileType.WALL;
  }

  _findEscapeRoute(position) {
    const visited = new Set();
    const queue = [{pos: position, path: [], depth: 0}];
    const maxDepth = 5; // Giới hạn độ sâu tìm kiếm
    
    while (queue.length > 0) {
      const {pos, path, depth} = queue.shift();
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)}`;
      
      if (!this._isInDanger(pos, this._getDangerousPositions()) && path.length > 0) {
        return path[0];
      }
      
      if (visited.has(key) || depth >= maxDepth) continue;
      visited.add(key);
      
      ['u', 'd', 'l', 'r'].forEach(dir => {
        const newPos = this._getNextPosition(pos, dir);
        if (!this._isBlocked(newPos)) {
          queue.push({
            pos: newPos,
            path: [...path, dir],
            depth: depth + 1
          });
        }
      });
    }
    
    return null;
  }

  _findBestEscapeRoute(position, dangerousPositions) {
    const visited = new Set();
    const queue = [{pos: position, path: [], depth: 0}];
    const maxDepth = 8; // Tăng độ sâu tìm kiếm
    let bestPath = null;
    let bestSafety = -1;
    
    while (queue.length > 0) {
      const {pos, path, depth} = queue.shift();
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)}`;
      
      if (!this._isInDanger(pos, dangerousPositions)) {
        // Đánh giá độ an toàn của vị trí
        const safetyScore = this._evaluateSafetyScore(pos);
        if (safetyScore > bestSafety) {
          bestSafety = safetyScore;
          bestPath = path;
        }
      }
      
      if (visited.has(key) || depth >= maxDepth) continue;
      visited.add(key);
      
      ['u', 'd', 'l', 'r'].forEach(dir => {
        const newPos = this._getNextPosition(pos, dir);
        if (!this._isBlocked(newPos) && !this._isWall(newPos)) {
          queue.push({
            pos: newPos,
            path: [...path, dir],
            depth: depth + 1
          });
        }
      });
    }
    
    return bestPath && bestPath.length > 0 ? bestPath[0] : null;
  }

  _evaluateSafetyScore(position) {
    let score = 0;
    
    // Càng xa bom càng an toàn
    this.lastKnownState.bombs.forEach(bomb => {
      const distance = this._getDistance(position, bomb.position);
      score += distance;
    });
    
    // Giảm điểm nếu gần tường
    if (this._isNearWall(position)) {
      score -= 5;
    }
    
    // Ưu tiên vị trí có nhiều đường thoát
    const escapeRoutes = this._countEscapeRoutes(position);
    score += escapeRoutes * 3;
    
    return score;
  }

  _isNearWall(position) {
    const directions = ['u', 'd', 'l', 'r'];
    return directions.some(dir => {
      const newPos = this._getNextPosition(position, dir);
      return this._isWall(newPos);
    });
  }

  _countEscapeRoutes(position) {
    return ['u', 'd', 'l', 'r'].filter(dir => {
      const newPos = this._getNextPosition(position, dir);
      return this._isValidPosition(newPos) && !this._isBlocked(newPos) && !this._isWall(newPos);
    }).length;
  }

  decideNextAction() {
    const botPlayer = Array.from(this.lastKnownState.players.values()).find(p => p.id === this.playerId);
    if (!botPlayer) return 'u';

    // Kiểm tra xem bot có đang bị kẹt không
    if (this.lastPosition) {
      const currentPos = `${Math.floor(botPlayer.position.x)},${Math.floor(botPlayer.position.y)}`;
      const lastPos = `${Math.floor(this.lastPosition.x)},${Math.floor(this.lastPosition.y)}`;
      
      if (currentPos === lastPos) {
        this.stuckCounter++;
      } else {
        this.stuckCounter = 0;
      }
    }
    
    // Lưu vị trí hiện tại cho lần sau
    this.lastPosition = {...botPlayer.position};

    const dangerousPositions = this._getDangerousPositions();

    // Ưu tiên đặt bom nếu an toàn và có gạch xung quanh
    if (botPlayer.bombsPlaced < botPlayer.bombLimit && !this._isInDanger(botPlayer.position, dangerousPositions)) {
      if (this._isGoodTimeToPlaceBomb(botPlayer)) {
        const escapeRoute = this._findBestEscapeRoute(botPlayer.position, dangerousPositions);
        if (escapeRoute) {
          console.log('Placing bomb, escape route:', escapeRoute);
          this.justPlacedBomb = true;
          return 'b';
        }
      }
    }

    // Nếu đang bị kẹt và có thể đặt bom an toàn
    if (this.stuckCounter >= 3 && botPlayer.bombsPlaced < botPlayer.bombLimit) {
      const escapeRoute = this._findBestEscapeRoute(botPlayer.position, dangerousPositions);
      if (escapeRoute) {
        this.justPlacedBomb = true;
        return 'b';
      }
    }

    // Thoát khỏi nguy hiểm
    if (this._isInDanger(botPlayer.position, dangerousPositions)) {
      const bestEscape = this._findBestEscapeRoute(botPlayer.position, dangerousPositions);
      if (bestEscape) {
        this.lastMove = bestEscape;
        return bestEscape;
      }
    }

    // Đặt bom khi có cơ hội tốt
    if (botPlayer.bombsPlaced < botPlayer.bombLimit) {
      if (this._isGoodTimeToPlaceBomb(botPlayer)) {
        const escapeRoute = this._findBestEscapeRoute(botPlayer.position, dangerousPositions);
        if (escapeRoute) {
          this.justPlacedBomb = true;
          return 'b';
        }
      }
    }

    // Tránh lặp lại nước đi
    const nextMove = this._findOptimalMove(botPlayer, dangerousPositions);
    if (nextMove) {
      this.lastMove = nextMove;
      return nextMove;
    }

    return this._getRandomSafeMove(botPlayer.position, dangerousPositions) || 'u';
  }

  _isGoodTimeToPlaceBomb(botPlayer) {
    // Kiểm tra có đường thoát trước khi quyết định đặt bom
    const dangerousPositions = this._getDangerousPositions();
    const hasEscape = this._findBestEscapeRoute(botPlayer.position, dangerousPositions) !== null;
    if (!hasEscape) return false;

    // Kiểm tra số gạch xung quanh
    const surroundingBricks = this._countSurroundingBricks(botPlayer.position);
    if (surroundingBricks > 0) {
      console.log('Found bricks nearby:', surroundingBricks);
      return true;
    }

    // Có kẻ địch gần đó
    const nearbyEnemy = this._findNearestEnemy(botPlayer);
    if (nearbyEnemy && this._isInRange(botPlayer.position, nearbyEnemy.position, 2)) {
      return true;
    }

    return false;
  }

  _countSurroundingBricks(position) {
    let brickCount = 0;
    ['u', 'd', 'l', 'r'].forEach(dir => {
      const newPos = this._getNextPosition(position, dir);
      if (this._isBrick(newPos)) {
        brickCount++;
      }
    });
    console.log('Brick count around position:', brickCount);
    return brickCount;
  }

  _countSurroundingBricks(position) {
    return ['u', 'd', 'l', 'r'].filter(dir => {
      const newPos = this._getNextPosition(position, dir);
      return this._isBrick(newPos);
    }).length;
  }

  _isBrick(position) {
    if (!this.lastKnownState.map || !this.lastKnownState.map.tiles) return false;
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    if (x < 0 || y < 0 || y >= this.lastKnownState.map.tiles.length || 
        x >= this.lastKnownState.map.tiles[0].length) return false;
    return this.lastKnownState.map.tiles[y][x] === TileType.BRICK;
  }

  _findOptimalMove(botPlayer, dangerousPositions) {
    let moves = ['u', 'd', 'l', 'r'].filter(dir => {
      const newPos = this._getNextPosition(botPlayer.position, dir);
      return this._isValidMove(newPos) && !this._isInDanger(newPos, dangerousPositions);
    });

    // Loại bỏ nước đi ngược lại với nước đi trước
    if (this.lastMove) {
      const oppositeMove = {
        'u': 'd',
        'd': 'u',
        'l': 'r',
        'r': 'l'
      };
      moves = moves.filter(move => move !== oppositeMove[this.lastMove]);
    }

    // Sắp xếp theo ưu tiên
    return moves.sort((a, b) => {
      const posA = this._getNextPosition(botPlayer.position, a);
      const posB = this._getNextPosition(botPlayer.position, b);
      return this._evaluatePosition(posB) - this._evaluatePosition(posA);
    })[0];
  }

  _evaluatePosition(position) {
    let score = 0;
    
    // Ưu tiên vị trí gần gạch
    const nearestBrick = this._findNearestBrick(position);
    if (nearestBrick) {
      score += 10 / (this._getDistance(position, nearestBrick) + 1);
    }

    // Ưu tiên vị trí gần item
    const nearestItem = this._findNearestItem(position);
    if (nearestItem) {
      score += 15 / (this._getDistance(position, nearestItem.position) + 1);
    }

    // Tránh vị trí bị kẹt
    score += this._countEscapeRoutes(position) * 2;

    return score;
  }

  // Các hàm hỗ trợ
  _getDangerousPositions() {
      const dangerous = new Set();
      
      // Thêm vị trí bom và vùng nổ
      this.lastKnownState.bombs.forEach(bomb => {
          dangerous.add(`${bomb.position.x},${bomb.position.y}`);
          
          // Thêm vùng nổ dự đoán
          const power = bomb.power || 2;
          for (let i = 1; i <= power; i++) {
              [[0,i], [0,-i], [i,0], [-i,0]].forEach(([dx, dy]) => {
                  const x = bomb.position.x + dx;
                  const y = bomb.position.y + dy;
                  if (this._isValidPosition({x, y})) {
                      dangerous.add(`${x},${y}`);
                  }
              });
          }
      });
      
      return dangerous;
  }

  _isInDanger(position, dangerousPositions) {
      return dangerousPositions.has(`${Math.floor(position.x)},${Math.floor(position.y)}`);
  }

  _findSafeMove(position, dangerousPositions) {
      const directions = ['u', 'd', 'l', 'r'];
      for (const dir of directions) {
          const newPos = this._getNextPosition(position, dir);
          if (this._isValidPosition(newPos) && !this._isInDanger(newPos, dangerousPositions)) {
              return dir;
          }
      }
      return null;
  }

  _getNextPosition(position, direction) {
      const pos = {x: position.x, y: position.y};
      switch(direction) {
          case 'u': pos.y--; break;
          case 'd': pos.y++; break;
          case 'l': pos.x--; break;
          case 'r': pos.x++; break;
      }
      return pos;
  }

  _isValidPosition(position) {
      if (!this.lastKnownState.map || !this.lastKnownState.map.tiles) return false;
      const x = Math.floor(position.x);
      const y = Math.floor(position.y);
      return x >= 0 && y >= 0 && 
            y < this.lastKnownState.map.tiles.length && 
            x < this.lastKnownState.map.tiles[0].length &&
            this.lastKnownState.map.tiles[y][x] !== TileType.WALL &&
            this.lastKnownState.map.tiles[y][x] !== TileType.BRICK;
  }

  _isValidMove(position) {
    // Kiểm tra tính hợp lệ của vị trí
    if (!this._isValidPosition(position)) return false;

    // Kiểm tra xem có bom ở vị trí này không
    const x = Math.floor(position.x);
    const y = Math.floor(position.y);
    const hasBomb = this.lastKnownState.bombs.some(bomb => 
      Math.floor(bomb.position.x) === x && Math.floor(bomb.position.y) === y
    );
    if (hasBomb) return false;

    // Kiểm tra tường và gạch
    if (this._isWall(position) || this._isBrick(position)) return false;

    // Kiểm tra có player khác ở vị trí này không
    const hasPlayer = Array.from(this.lastKnownState.players.values()).some(player => 
      player.id !== this.playerId && 
      player.status !== 'dead' && 
      Math.floor(player.position.x) === x && 
      Math.floor(player.position.y) === y
    );
    if (hasPlayer) return false;

    return true;
  }

  _findNearestEnemy(botPlayer) {
      let nearest = null;
      let minDistance = Infinity;
      
      Array.from(this.lastKnownState.players.values()).forEach(player => {
          if (player.id !== this.playerId && player.teamId !== botPlayer.teamId && player.status !== 'dead') {
              const distance = this._getDistance(botPlayer.position, player.position);
              if (distance < minDistance) {
                  minDistance = distance;
                  nearest = player;
              }
          }
      });
      
      return nearest;
  }

  _findNearestItem(position) {
      return this.lastKnownState.items.reduce((nearest, item) => {
          const distance = this._getDistance(position, item.position);
          if (!nearest || distance < this._getDistance(position, nearest.position)) {
              return item;
          }
          return nearest;
      }, null);
  }

  _getDistance(pos1, pos2) {
      return Math.abs(pos1.x - pos2.x) + Math.abs(pos1.y - pos2.y);
  }

  _getDirectionTo(from, to) {
      const dx = to.x - from.x;
      const dy = to.y - from.y;
      
      if (Math.abs(dx) > Math.abs(dy)) {
          return dx > 0 ? 'r' : 'l';
      } else {
          return dy > 0 ? 'd' : 'u';
      }
  }

  _isInRange(pos1, pos2, range) {
      return this._getDistance(pos1, pos2) <= range;
  }

  _findEscapeRoute(position) {
      const visited = new Set();
      const queue = [{pos: position, path: []}];
      
      while (queue.length > 0) {
          const {pos, path} = queue.shift();
          const key = `${pos.x},${pos.y}`;
          
          if (!this._isInDanger(pos, this._getDangerousPositions()) && path.length > 0) {
              return path[0];
          }
          
          if (visited.has(key)) continue;
          visited.add(key);
          
          ['u', 'd', 'l', 'r'].forEach(dir => {
              const newPos = this._getNextPosition(pos, dir);
              if (this._isValidPosition(newPos)) {
                  queue.push({
                      pos: newPos,
                      path: [...path, dir]
                  });
              }
          });
      }
      
      return null;
  }

  _findPathAwayFromWall(position) {
    const visited = new Set();
    const queue = [{pos: position, path: [], depth: 0}];
    const maxDepth = 5;
    
    while (queue.length > 0) {
      const {pos, path, depth} = queue.shift();
      const key = `${Math.floor(pos.x)},${Math.floor(pos.y)}`;
      
      if (!this._isNearWall(pos) && this._countEscapeRoutes(pos) > 2 && path.length > 0) {
        return path[0];
      }
      
      if (visited.has(key) || depth >= maxDepth) continue;
      visited.add(key);
      
      ['u', 'd', 'l', 'r'].forEach(dir => {
        const newPos = this._getNextPosition(pos, dir);
        if (!this._isBlocked(newPos) && !this._isWall(newPos)) {
          queue.push({
            pos: newPos,
            path: [...path, dir],
            depth: depth + 1
          });
        }
      });
    }
    
    return this._getRandomSafeMove(position, this._getDangerousPositions());
  }

  _getRandomSafeMove(position, dangerousPositions) {
    // Ưu tiên hướng có nhiều đường thoát
    const safeMoves = ['u', 'd', 'l', 'r']
      .filter(dir => {
        const newPos = this._getNextPosition(position, dir);
        return this._isValidPosition(newPos) && 
               !this._isInDanger(newPos, dangerousPositions) && 
               !this._isWall(newPos);
      })
      .sort((a, b) => {
        const posA = this._getNextPosition(position, a);
        const posB = this._getNextPosition(position, b);
        return this._countEscapeRoutes(posB) - this._countEscapeRoutes(posA);
      });

    return safeMoves.length > 0 ? safeMoves[0] : null;
  }
}

exports.BotController = BotController;
