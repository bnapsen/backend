(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.NeonChessCore = api;
  }
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const BOARD_SIZE = 8;
  const FILES = 'abcdefgh';
  const COLORS = ['white', 'black'];
  const PROMOTIONS = ['queen', 'rook', 'bishop', 'knight'];
  const BACK_RANK = ['rook', 'knight', 'bishop', 'queen', 'king', 'bishop', 'knight', 'rook'];
  const PIECES = {
    king: { name: 'King', short: 'K', value: 1000, glyphs: { white: '\u2654', black: '\u265A' } },
    queen: { name: 'Queen', short: 'Q', value: 9, glyphs: { white: '\u2655', black: '\u265B' } },
    rook: { name: 'Rook', short: 'R', value: 5, glyphs: { white: '\u2656', black: '\u265C' } },
    bishop: { name: 'Bishop', short: 'B', value: 3, glyphs: { white: '\u2657', black: '\u265D' } },
    knight: { name: 'Knight', short: 'N', value: 3, glyphs: { white: '\u2658', black: '\u265E' } },
    pawn: { name: 'Pawn', short: '', value: 1, glyphs: { white: '\u2659', black: '\u265F' } },
  };

  let pieceSeed = 1;

  function randomId() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    pieceSeed += 1;
    return `piece-${pieceSeed}-${Date.now().toString(36)}`;
  }

  function capitalize(value) {
    return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : '';
  }

  function otherColor(color) {
    return color === 'white' ? 'black' : 'white';
  }

  function insideBoard(x, y) {
    return x >= 0 && x < BOARD_SIZE && y >= 0 && y < BOARD_SIZE;
  }

  function getPiece(board, x, y) {
    if (!insideBoard(x, y)) {
      return null;
    }
    return board[y][x];
  }

  function clonePiece(piece) {
    return piece ? { ...piece } : null;
  }

  function cloneBoard(board) {
    return board.map((row) => row.map((piece) => clonePiece(piece)));
  }

  function cloneMoveRecord(record) {
    return {
      ...record,
      from: record.from ? { ...record.from } : null,
      to: record.to ? { ...record.to } : null,
      capture: record.capture ? { ...record.capture } : null,
    };
  }

  function cloneState(state) {
    return {
      ...state,
      board: cloneBoard(state.board),
      captured: {
        white: state.captured.white.map((piece) => ({ ...piece })),
        black: state.captured.black.map((piece) => ({ ...piece })),
      },
      history: state.history.map((entry) => ({ ...entry })),
      lastMove: state.lastMove ? cloneMoveRecord(state.lastMove) : null,
      enPassant: state.enPassant ? { ...state.enPassant } : null,
    };
  }

  function createPiece(type, color) {
    return {
      id: `${color}-${type}-${randomId()}`,
      type,
      color,
      moved: false,
    };
  }

  function createInitialBoard() {
    const board = Array.from({ length: BOARD_SIZE }, () => Array.from({ length: BOARD_SIZE }, () => null));

    for (let fileIndex = 0; fileIndex < BOARD_SIZE; fileIndex += 1) {
      board[0][fileIndex] = createPiece(BACK_RANK[fileIndex], 'black');
      board[1][fileIndex] = createPiece('pawn', 'black');
      board[BOARD_SIZE - 2][fileIndex] = createPiece('pawn', 'white');
      board[BOARD_SIZE - 1][fileIndex] = createPiece(BACK_RANK[fileIndex], 'white');
    }

    return board;
  }

  function createGameState() {
    return {
      title: 'Neon Crown Chess',
      boardSize: BOARD_SIZE,
      maxPlayers: 2,
      board: createInitialBoard(),
      turn: 'white',
      winner: null,
      drawReason: null,
      check: null,
      status: 'White to move.',
      history: [],
      captured: {
        white: [],
        black: [],
      },
      lastMove: null,
      enPassant: null,
      halfmoveClock: 0,
      moveNumber: 1,
      promotions: [...PROMOTIONS],
      pieceInfo: Object.fromEntries(Object.entries(PIECES).map(([key, value]) => [key, value.name])),
    };
  }

  function coordToNotation(x, y) {
    return `${FILES[x]}${BOARD_SIZE - y}`;
  }

  function findKing(board, color) {
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const piece = board[y][x];
        if (piece && piece.type === 'king' && piece.color === color) {
          return { x, y };
        }
      }
    }
    return null;
  }

  function pushSlidingAttacks(board, x, y, color, directions, attackers) {
    for (const [dx, dy] of directions) {
      let step = 1;
      while (true) {
        const nextX = x + (dx * step);
        const nextY = y + (dy * step);
        if (!insideBoard(nextX, nextY)) {
          break;
        }
        const target = getPiece(board, nextX, nextY);
        if (!target) {
          step += 1;
          continue;
        }
        if (target.color === color && attackers.includes(target.type)) {
          return true;
        }
        break;
      }
    }
    return false;
  }

  function isSquareAttacked(board, x, y, byColor) {
    const pawnRow = byColor === 'white' ? y + 1 : y - 1;
    for (const fileDelta of [-1, 1]) {
      const pawn = getPiece(board, x + fileDelta, pawnRow);
      if (pawn && pawn.color === byColor && pawn.type === 'pawn') {
        return true;
      }
    }

    const knightOffsets = [
      [1, 2], [2, 1], [2, -1], [1, -2],
      [-1, -2], [-2, -1], [-2, 1], [-1, 2],
    ];
    for (const [dx, dy] of knightOffsets) {
      const knight = getPiece(board, x + dx, y + dy);
      if (knight && knight.color === byColor && knight.type === 'knight') {
        return true;
      }
    }

    for (let dx = -1; dx <= 1; dx += 1) {
      for (let dy = -1; dy <= 1; dy += 1) {
        if (dx === 0 && dy === 0) continue;
        const king = getPiece(board, x + dx, y + dy);
        if (king && king.color === byColor && king.type === 'king') {
          return true;
        }
      }
    }

    if (pushSlidingAttacks(board, x, y, byColor, [[1, 0], [-1, 0], [0, 1], [0, -1]], ['rook', 'queen'])) {
      return true;
    }

    if (pushSlidingAttacks(board, x, y, byColor, [[1, 1], [1, -1], [-1, 1], [-1, -1]], ['bishop', 'queen'])) {
      return true;
    }

    return false;
  }

  function isKingInCheck(state, color) {
    const kingSquare = findKing(state.board, color);
    if (!kingSquare) {
      return true;
    }
    return isSquareAttacked(state.board, kingSquare.x, kingSquare.y, otherColor(color));
  }

  function getPseudoMoves(state, x, y, options) {
    const settings = options || {};
    const piece = getPiece(state.board, x, y);
    if (!piece) {
      return [];
    }

    const moves = [];
    const board = state.board;

    function pushStepMove(nextX, nextY, extra) {
      if (!insideBoard(nextX, nextY)) {
        return;
      }
      const target = getPiece(board, nextX, nextY);
      if (!target || (target.color !== piece.color && target.type !== 'king')) {
        moves.push({
          x: nextX,
          y: nextY,
          capture: Boolean(target),
          ...extra,
        });
      }
    }

    function pushSlidingMoves(directions) {
      for (const [dx, dy] of directions) {
        let step = 1;
        while (true) {
          const nextX = x + (dx * step);
          const nextY = y + (dy * step);
          if (!insideBoard(nextX, nextY)) {
            break;
          }
          const target = getPiece(board, nextX, nextY);
          if (!target) {
            moves.push({ x: nextX, y: nextY, capture: false });
            step += 1;
            continue;
          }
          if (target.color !== piece.color && target.type !== 'king') {
            moves.push({ x: nextX, y: nextY, capture: true });
          }
          break;
        }
      }
    }

    switch (piece.type) {
      case 'pawn': {
        const direction = piece.color === 'white' ? -1 : 1;
        const startRow = piece.color === 'white' ? 6 : 1;
        const oneForward = y + direction;
        if (!settings.attacksOnly) {
          if (insideBoard(x, oneForward) && !getPiece(board, x, oneForward)) {
            moves.push({
              x,
              y: oneForward,
              capture: false,
              promotionRequired: oneForward === 0 || oneForward === BOARD_SIZE - 1,
            });
            const twoForward = y + (direction * 2);
            if (y === startRow && !getPiece(board, x, twoForward)) {
              moves.push({
                x,
                y: twoForward,
                capture: false,
                special: 'double-step',
              });
            }
          }
        }

        for (const dx of [-1, 1]) {
          const nextX = x + dx;
          const nextY = y + direction;
          if (!insideBoard(nextX, nextY)) {
            continue;
          }

          if (settings.attacksOnly) {
            moves.push({ x: nextX, y: nextY, capture: true });
            continue;
          }

          const target = getPiece(board, nextX, nextY);
          if (target && target.color !== piece.color && target.type !== 'king') {
            moves.push({
              x: nextX,
              y: nextY,
              capture: true,
              promotionRequired: nextY === 0 || nextY === BOARD_SIZE - 1,
            });
            continue;
          }

          if (
            state.enPassant &&
            state.enPassant.x === nextX &&
            state.enPassant.y === nextY &&
            state.enPassant.vulnerableColor !== piece.color
          ) {
            moves.push({
              x: nextX,
              y: nextY,
              capture: true,
              special: 'en-passant',
            });
          }
        }
        break;
      }

      case 'rook':
        pushSlidingMoves([[1, 0], [-1, 0], [0, 1], [0, -1]]);
        break;

      case 'bishop':
        pushSlidingMoves([[1, 1], [1, -1], [-1, 1], [-1, -1]]);
        break;

      case 'queen':
        pushSlidingMoves([[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]);
        break;

      case 'knight': {
        const offsets = [
          [1, 2], [2, 1], [2, -1], [1, -2],
          [-1, -2], [-2, -1], [-2, 1], [-1, 2],
        ];
        for (const [dx, dy] of offsets) {
          pushStepMove(x + dx, y + dy);
        }
        break;
      }

      case 'king': {
        for (let dx = -1; dx <= 1; dx += 1) {
          for (let dy = -1; dy <= 1; dy += 1) {
            if (dx === 0 && dy === 0) {
              continue;
            }
            pushStepMove(x + dx, y + dy);
          }
        }

        if (!settings.attacksOnly && !piece.moved && !isKingInCheck(state, piece.color)) {
          const homeRow = piece.color === 'white' ? 7 : 0;

          const kingSideRook = getPiece(board, 7, homeRow);
          if (
            kingSideRook &&
            kingSideRook.color === piece.color &&
            kingSideRook.type === 'rook' &&
            !kingSideRook.moved &&
            !getPiece(board, 5, homeRow) &&
            !getPiece(board, 6, homeRow) &&
            !isSquareAttacked(board, 5, homeRow, otherColor(piece.color)) &&
            !isSquareAttacked(board, 6, homeRow, otherColor(piece.color))
          ) {
            moves.push({ x: 6, y: homeRow, capture: false, special: 'castle-kingside' });
          }

          const queenSideRook = getPiece(board, 0, homeRow);
          if (
            queenSideRook &&
            queenSideRook.color === piece.color &&
            queenSideRook.type === 'rook' &&
            !queenSideRook.moved &&
            !getPiece(board, 1, homeRow) &&
            !getPiece(board, 2, homeRow) &&
            !getPiece(board, 3, homeRow) &&
            !isSquareAttacked(board, 3, homeRow, otherColor(piece.color)) &&
            !isSquareAttacked(board, 2, homeRow, otherColor(piece.color))
          ) {
            moves.push({ x: 2, y: homeRow, capture: false, special: 'castle-queenside' });
          }
        }
        break;
      }

      default:
        break;
    }

    return moves;
  }

  function normalizePromotion(value) {
    if (PROMOTIONS.includes(value)) {
      return value;
    }
    return 'queen';
  }

  function applyMoveUnchecked(state, move) {
    const piece = getPiece(state.board, move.from.x, move.from.y);
    if (!piece) {
      return null;
    }

    const board = state.board;
    let capturedPiece = getPiece(board, move.to.x, move.to.y);
    let castleSide = null;
    let promotion = null;

    if (move.special === 'en-passant') {
      const captureY = piece.color === 'white' ? move.to.y + 1 : move.to.y - 1;
      capturedPiece = getPiece(board, move.to.x, captureY);
      board[captureY][move.to.x] = null;
    }

    board[move.from.y][move.from.x] = null;

    const movedPiece = {
      ...piece,
      moved: true,
    };

    if (piece.type === 'pawn' && (move.to.y === 0 || move.to.y === BOARD_SIZE - 1)) {
      promotion = normalizePromotion(move.promotion);
      movedPiece.type = promotion;
    }

    board[move.to.y][move.to.x] = movedPiece;

    if (piece.type === 'king' && Math.abs(move.to.x - move.from.x) === 2) {
      const rookFromX = move.to.x > move.from.x ? 7 : 0;
      const rookToX = move.to.x > move.from.x ? 5 : 3;
      const rook = getPiece(board, rookFromX, move.from.y);
      board[move.from.y][rookFromX] = null;
      board[move.from.y][rookToX] = {
        ...rook,
        moved: true,
      };
      castleSide = move.to.x > move.from.x ? 'kingside' : 'queenside';
    }

    state.enPassant = null;
    if (piece.type === 'pawn' && Math.abs(move.to.y - move.from.y) === 2) {
      state.enPassant = {
        x: move.from.x,
        y: (move.from.y + move.to.y) / 2,
        vulnerableColor: piece.color,
      };
    }

    if (capturedPiece) {
      state.captured[piece.color].push({ ...capturedPiece });
    }

    state.halfmoveClock = piece.type === 'pawn' || capturedPiece ? 0 : state.halfmoveClock + 1;
    if (piece.color === 'black') {
      state.moveNumber += 1;
    }

    state.lastMove = {
      color: piece.color,
      piece: piece.type,
      from: { ...move.from },
      to: { ...move.to },
      capture: capturedPiece ? { ...capturedPiece } : null,
      promotion,
      castleSide,
    };

    return {
      piece,
      movedPiece,
      capturedPiece,
      promotion,
      castleSide,
    };
  }

  function getLegalMoves(state, x, y) {
    const piece = getPiece(state.board, x, y);
    if (!piece || piece.color !== state.turn) {
      return [];
    }

    const pseudoMoves = getPseudoMoves(state, x, y);
    const legalMoves = [];

    for (const move of pseudoMoves) {
      const sandbox = cloneState(state);
      applyMoveUnchecked(sandbox, {
        from: { x, y },
        to: { x: move.x, y: move.y },
        special: move.special,
        promotion: move.promotionRequired ? 'queen' : move.promotion,
      });

      if (!isKingInCheck(sandbox, piece.color)) {
        legalMoves.push({ ...move });
      }
    }

    return legalMoves;
  }

  function getAllLegalMoves(state, color) {
    const moves = [];
    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const piece = getPiece(state.board, x, y);
        if (!piece || piece.color !== color) {
          continue;
        }
        const legalMoves = getLegalMoves({ ...state, turn: color }, x, y);
        for (const move of legalMoves) {
          moves.push({
            from: { x, y },
            to: { x: move.x, y: move.y },
            special: move.special || null,
            promotionRequired: Boolean(move.promotionRequired),
            capture: Boolean(move.capture),
          });
        }
      }
    }
    return moves;
  }

  function hasInsufficientMaterial(state) {
    const material = {
      white: [],
      black: [],
    };

    for (let y = 0; y < BOARD_SIZE; y += 1) {
      for (let x = 0; x < BOARD_SIZE; x += 1) {
        const piece = getPiece(state.board, x, y);
        if (!piece || piece.type === 'king') {
          continue;
        }
        material[piece.color].push({ type: piece.type, squareColor: (x + y) % 2 });
      }
    }

    const whitePieces = material.white;
    const blackPieces = material.black;

    if (whitePieces.length === 0 && blackPieces.length === 0) {
      return true;
    }

    const loneMinor = (pieces) => pieces.length === 1 && ['bishop', 'knight'].includes(pieces[0].type);
    if ((whitePieces.length === 0 && loneMinor(blackPieces)) || (blackPieces.length === 0 && loneMinor(whitePieces))) {
      return true;
    }

    if (
      whitePieces.length === 1 &&
      blackPieces.length === 1 &&
      whitePieces[0].type === 'bishop' &&
      blackPieces[0].type === 'bishop' &&
      whitePieces[0].squareColor === blackPieces[0].squareColor
    ) {
      return true;
    }

    return false;
  }

  function formatMoveNotation(piece, move, details, inCheck, checkmate) {
    if (details.castleSide === 'kingside') {
      return checkmate ? 'O-O#' : inCheck ? 'O-O+' : 'O-O';
    }
    if (details.castleSide === 'queenside') {
      return checkmate ? 'O-O-O#' : inCheck ? 'O-O-O+' : 'O-O-O';
    }

    const from = coordToNotation(move.from.x, move.from.y);
    const to = coordToNotation(move.to.x, move.to.y);
    const piecePrefix = piece.type === 'pawn' ? from : `${PIECES[piece.type].short}${from}`;
    const separator = details.capturedPiece ? 'x' : '-';
    let notation = `${piecePrefix}${separator}${to}`;

    if (details.promotion) {
      notation += `=${PIECES[details.promotion].short}`;
    }

    if (checkmate) {
      notation += '#';
    } else if (inCheck) {
      notation += '+';
    }

    return notation;
  }

  function finalizeState(state, movedColor, move, details) {
    const nextColor = otherColor(movedColor);
    state.turn = nextColor;

    const inCheck = isKingInCheck(state, nextColor);
    state.check = inCheck ? nextColor : null;
    const legalReplies = getAllLegalMoves(state, nextColor);

    if (legalReplies.length === 0) {
      if (inCheck) {
        state.winner = movedColor;
        state.drawReason = null;
        state.status = `Checkmate. ${capitalize(movedColor)} wins.`;
      } else {
        state.winner = null;
        state.drawReason = 'stalemate';
        state.status = 'Draw by stalemate.';
      }
    } else if (state.halfmoveClock >= 100) {
      state.winner = null;
      state.drawReason = 'fifty-move';
      state.status = 'Draw by fifty-move rule.';
    } else if (hasInsufficientMaterial(state)) {
      state.winner = null;
      state.drawReason = 'insufficient-material';
      state.status = 'Draw by insufficient material.';
    } else {
      state.winner = null;
      state.drawReason = null;
      state.status = inCheck ? `${capitalize(nextColor)} is in check.` : `${capitalize(nextColor)} to move.`;
    }

    const checkmate = state.winner === movedColor;
    const notation = formatMoveNotation(details.piece, move, details, inCheck, checkmate);
    state.lastMove.notation = notation;
    state.history.push({
      fullMove: details.fullMove,
      color: movedColor,
      notation,
    });
  }

  function applyMove(state, move) {
    if (!move || !move.from || !move.to) {
      return { ok: false, error: 'Move is missing a starting or ending square.' };
    }

    if (state.winner || state.drawReason) {
      return { ok: false, error: 'The game is finished. Restart to play again.' };
    }

    const { from, to } = move;
    if (!insideBoard(from.x, from.y) || !insideBoard(to.x, to.y)) {
      return { ok: false, error: 'Move is outside the board.' };
    }

    const piece = getPiece(state.board, from.x, from.y);
    if (!piece) {
      return { ok: false, error: 'There is no piece on that square.' };
    }

    if (piece.color !== state.turn) {
      return { ok: false, error: `It is ${capitalize(state.turn)}'s turn.` };
    }

    const legalMoves = getLegalMoves(state, from.x, from.y);
    const matchedMove = legalMoves.find((legalMove) => legalMove.x === to.x && legalMove.y === to.y);
    if (!matchedMove) {
      return { ok: false, error: 'That move is not legal.' };
    }

    const fullMove = state.moveNumber;
    const details = applyMoveUnchecked(state, {
      from: { ...from },
      to: { ...to },
      special: matchedMove.special,
      promotion: move.promotion || (matchedMove.promotionRequired ? 'queen' : undefined),
    });

    if (!details) {
      return { ok: false, error: 'Unable to apply the move.' };
    }

    finalizeState(state, piece.color, move, {
      ...details,
      piece: { ...piece },
      fullMove,
    });

    return {
      ok: true,
      move: state.lastMove ? cloneMoveRecord(state.lastMove) : null,
      notation: state.lastMove ? state.lastMove.notation : null,
    };
  }

  function getPieceGlyph(piece) {
    if (!piece || !PIECES[piece.type]) {
      return '';
    }
    return PIECES[piece.type].glyphs[piece.color];
  }

  return {
    BOARD_SIZE,
    FILES,
    COLORS,
    PIECES,
    PROMOTIONS,
    createGameState,
    cloneState,
    getPiece,
    getLegalMoves,
    getAllLegalMoves,
    applyMove,
    coordToNotation,
    getPieceGlyph,
    otherColor,
    isKingInCheck,
  };
}));
