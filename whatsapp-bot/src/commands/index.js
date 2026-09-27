// Registro de comandos. Para agregar uno: crea su carpeta en commands/ y súmalo a esta lista.
// Cada comando: { name, aliases?, description, usage, run(ctx) }.
import { createImgCommand } from './img/img.command.js';
import { createYoutubeCommand } from './youtube/youtube.command.js';
import { createVideoCommand } from './video/video.command.js';
import { createTwitterCommand } from './twitter/twitter.command.js';
import { createYtcookiesCommand } from './ytcookies/ytcookies.command.js';
import { helpCommand } from './help/help.command.js';

export function createCommands({ imageSearch, youtubeSearch, youtubeDownloader, videoSearch, xFeed, youtubeCookies }) {
  return [
    createImgCommand({ getImages: imageSearch.getRandomImages }),
    createYoutubeCommand({ findFirstVideo: youtubeSearch.findFirstVideo, downloader: youtubeDownloader }),
    createYoutubeCommand({ findFirstVideo: youtubeSearch.findFirstVideo, downloader: youtubeDownloader, mode: 'audio' }),
    createVideoCommand({
      searchVideos: videoSearch.searchVideos,
      downloadVideo: videoSearch.downloadVideo,
      maxMinutes: videoSearch.MAX_MINUTES,
    }),
    createTwitterCommand({ feed: xFeed }),
    createYtcookiesCommand(youtubeCookies),
    helpCommand,
  ];
}
