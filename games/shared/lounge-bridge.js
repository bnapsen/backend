(function (global) {
  'use strict';

  function sanitizeRoomCode(value) {
    return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  }

  function sanitizeText(value, maxLength) {
    return String(value || '').trim().replace(/\s+/g, ' ').slice(0, maxLength);
  }

  function loungeUrl() {
    if (global.location.origin && global.location.origin !== 'null') {
      return new URL('/arcade-lounge.html', `${global.location.origin}/`);
    }
    if (global.location.pathname.indexOf('/games/') !== -1 || global.location.pathname.indexOf('\\games\\') !== -1) {
      return new URL('../../arcade-lounge.html', global.location.href);
    }
    return new URL('arcade-lounge.html', global.location.href);
  }

  function buildUrl(options) {
    const settings = options || {};
    const url = loungeUrl();
    const name = sanitizeText(settings.name, 18);
    const serverUrl = String(settings.serverUrl || '').trim();
    const roomCode = sanitizeRoomCode(settings.roomCode);
    const inviteUrl = String(settings.inviteUrl || '').trim();
    const note = sanitizeText(settings.note, 140);
    const gameType = String(settings.gameType || '').trim();

    if (name) {
      url.searchParams.set('name', name);
    }
    if (serverUrl) {
      url.searchParams.set('server', serverUrl);
    }
    if (settings.openPublic !== false) {
      url.searchParams.set('lounge', 'public');
    }
    if (gameType) {
      url.searchParams.set('shareGame', gameType);
    }
    if (roomCode) {
      url.searchParams.set('shareRoom', roomCode);
    }
    if (inviteUrl) {
      url.searchParams.set('shareUrl', inviteUrl);
    }
    if (note) {
      url.searchParams.set('shareNote', note);
    }
    if (settings.autoShare) {
      url.searchParams.set('autoShare', '1');
    }
    return url.toString();
  }

  function open(options) {
    const url = buildUrl(options);
    global.open(url, '_blank', 'noopener');
    return url;
  }

  global.NovaArcadeLoungeBridge = {
    buildUrl,
    open,
  };
})(window);
