(function () {
  if (window.matchMedia && window.matchMedia("all").addEventListener) {
    return false;
  }

  let localMatchMedia = window.matchMedia;

  window.matchMedia = function (media) {
    let mql = localMatchMedia(media);

    mql.addEventListener = function (event, listener) {
      mql.addListener(listener);
    };

    mql.removeEventListener = function (event, listener) {
      mql.removeListener(listener);
    };

    return mql;
  };
})();
