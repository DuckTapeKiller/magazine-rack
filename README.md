<h1 align="center">Magazine Rack</h1>

<p align="center"><strong>The Reading Room: a front page for the magazines you read, inside Obsidian.</strong></p>

<p align="center">
  <a href="https://github.com/CasaAmarillaRoja/reading_room/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/CasaAmarillaRoja/reading_room?style=flat-square&label=release&color=7a5c99"></a>
  <img alt="Obsidian 1.4 or later" src="https://img.shields.io/badge/Obsidian-1.4%2B-483699?style=flat-square&logo=obsidian&logoColor=white">
  <img alt="Desktop and mobile" src="https://img.shields.io/badge/desktop%20%26%20mobile-supported-3d7a5a?style=flat-square">
  <img alt="English and Spanish" src="https://img.shields.io/badge/page-English%20%C2%B7%20Espa%C3%B1ol-b5543a?style=flat-square">
  <a href="https://ko-fi.com/ducktapekiller"><img alt="Support on Ko-fi" src="https://img.shields.io/badge/Ko--fi-support-FF5E5B?style=flat-square&logo=ko-fi&logoColor=white"></a>
</p>

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/front-page-dark.jpg">
    <img alt="The Reading Room in Obsidian, showing The Public Domain Review: a large lead story with its picture, then a grid of picture cards" src="docs/front-page-light.jpg" width="900">
  </picture>
</p>

Magazine Rack turns one note into a page you want to open: the newest pieces from the magazines you follow, each with its picture, headline, standfirst and author, laid out like the front of a magazine. Click a story and it opens in your browser. Save it for later, mark it read, take it off the page, or clip it into your vault with your Obsidian Web Clipper templates. The page keeps itself up to date while Obsidian is open.

It comes set up with seven magazines: **Aeon**, **JSTOR Daily**, **The Atlantic**, **The New York Times**, **Epoché**, **The Public Domain Review** and **The New York Review of Books**. You can add any other magazine, newspaper, journal or blog that publishes a feed, which is almost all of them.

## What is on the page

- **A masthead** with today's date, the page title, how many pieces are new today and when it last checked, with three buttons: check now, *Unread only*, and *Mark all as read*.
- **A chip for each magazine**, with a count of today's unread pieces, and a **Saved** chip for what you have put aside. Click one to see only that magazine, or only your saved pieces; click *Everything* to go back.
- **Just in**: the newest piece across all your magazines as a large lead story, with the next four beside it.
- **Saved for later**: the pieces you have saved, kept until you take them off the list, even after they leave the magazine's feed.
- **A section for each magazine**, in its own colour. Its newest article leads, picture beside the words, followed by a grid of cards.
- **A tag on every picture** naming the magazine, so you always know where a piece comes from.
- **New and read.** Pieces from the last 24 hours carry a *New* badge until you open them. Opened pieces are dimmed and marked *Read*.
- **No picture, no gap.** An article without one gets a plate with the magazine's initials on its colour.

The page takes its colours from your theme, so it looks at home in light mode, dark mode and any community theme. It can speak English or Spanish: the dates, labels and menus follow the language you choose in the settings.

## Save, read, remove, clip

<p align="center">
  <img alt="A card with its buttons showing: save for later, mark as read, clip to vault, remove, and more" src="docs/card-buttons.png" width="260">
  &nbsp;&nbsp;&nbsp;
  <img alt="The menu of a card: save for later, mark as read, remove from the page, clip to vault, clip with a chosen template, copy link" src="docs/card-menu.png" width="372">
</p>

Point at a card and five buttons appear on its picture:

- **Save for later**, which keeps the piece in *Saved for later* until you take it off;
- **Mark as read**, or unread again;
- **Clip to vault** (see below);
- **Remove**, which takes the piece off the page;
- **More**, which opens the menu with everything above, a *Clip with…* entry for each of your templates, and *Copy link*.

Right-clicking a card opens the same menu. On a phone or tablet the picture shows only the menu button, and the small rows have it at the end of their label line. Saving, removing and *Mark all as read* each show a message with **Undo**.

*Unread only* hides everything you have read, across the whole page. *Mark all as read* in the masthead covers what the page is showing; each section has its own as well.

Feeds only hold their newest pieces, and a busy one such as *The New York Times*' top stories moves on within hours. So the page keeps every article for a week after it leaves its feed, or for as long as you choose.

## Clip to vault with your Web Clipper templates

<p align="center"><img alt="The Clip to vault settings: how to import Web Clipper templates, the imported templates with their folders and triggers, and the import buttons" src="docs/clip-settings.png" width="760"></p>

The scissors save an article as a note in your vault, using your [Obsidian Web Clipper](https://obsidian.md/clipper) templates: the same folder, note name, properties and content you get in your browser.

1. **In Web Clipper's settings**, open a template and choose *Export* (or *More → Copy to clipboard*).
2. **In Settings → Magazine Rack → Clip to vault**, press *Import templates…*, or *Paste a template*. Import as many as you like.

Each template's **triggers** pick it by web address, as in Web Clipper, so an essay from Aeon can go to one folder and a review to another. When no trigger matches, the first template without triggers is used; until you import one, clips use Web Clipper's own default template, a note in *Clippings*. All of Web Clipper's ways of saving work: a new note, overwrite, add to the top or bottom of a note, or add to today's daily note.

Magazine Rack fills templates with the two libraries Web Clipper itself is built on: [Defuddle](https://github.com/kepano/defuddle), which finds the article in the page and turns it into Markdown, and [Knap](https://github.com/obsidianmd/knap), Web Clipper's template language, with all its variables, filters and logic. On Web Clipper's own six test pages, Magazine Rack produces the same notes as Web Clipper, apart from one timestamp written in the local time zone.

Three things it cannot do that Web Clipper in your browser can:

- **Paywalled articles.** It reads the page without your browser's sign-in, so a subscriber-only article may come through as its opening paragraphs, and a site may refuse it outright. Magazine Rack tells you when the text looks short. For those, open the article and use Web Clipper in your browser.
- **Things a page draws with scripts after it loads**, such as some prices, may be missing.
- **Interpreter prompts** (Web Clipper's AI variables) are left empty, and there are no highlights to include.

## On your phone

<img align="right" width="260" alt="The Reading Room on a phone: the masthead with its buttons, the magazine chips and a lead story" src="docs/phone.jpg">

The layout follows the width of the pane, not the device, so it works on a phone, on a tablet and in a narrow side pane on the desktop.

On a narrow screen the chips scroll sideways and the chosen one stays in view. Each magazine's lead story keeps its full picture, and the rest become rows with a square thumbnail, the magazine's name and when the piece was published.

Everything runs in Obsidian itself, on desktop and mobile alike. There is no server and no account.

The note opens in reading view each time, even in vaults that open notes for editing. If you switch it to editing on purpose, it stays that way until you next open it.

<br clear="right">

## Adding a magazine

Open **Settings → Magazine Rack**. Above the list of magazines there is a short guide:

<p align="center"><img alt="The guide in the settings: how to add a magazine, find its feed and test it" src="docs/settings-guide.png" width="760"></p>

1. **Press *Add a magazine*.** Type its name and its website address, for example `https://www.lrb.co.uk`.
2. **Press *Find the feed*.** The plugin reads the feed the site announces in its pages, and tries the usual addresses if it announces none.
3. **If nothing is found,** search the web for the magazine's name followed by *RSS feed*, or try the website address followed by `/feed`, `/rss` or `/rss.xml`. Paste what you find into *Feeds*. Sections of a site often have feeds of their own: put several on separate lines and they are merged into one section, newest first.
4. **Press *Test the feeds*.** Each address reports how many articles it holds, its newest headline, and whether the feed carries pictures. *The site sent a web page instead of the feed* means that address is not a feed.
5. **Leave out** what you never read, if you like: a word or phrase drops articles with it in the headline, and anything with a `/` is matched against the web address, such as `/podcasts/`.
6. **Save.** The new section appears a few seconds later.

<p align="center"><img alt="The Add a magazine dialog: the London Review of Books feed found and tested, a wrong address flagged, and a Leave out list" src="docs/add-a-magazine.png" width="420"></p>

Two tips. If every article shows the same author, the feed is naming its editor rather than its writers: switch off *Show authors* for that magazine. And paywalled magazines work too: the page links to each article, and you read it with your own subscription.

## Where the pictures come from

From the feed, where it carries them. Where it does not (Epoché and The New York Review of Books, for example), Magazine Rack reads the picture each article page offers for sharing, once per article, and remembers it. A site that refuses that request gets the initials plate instead.

## The magazines it starts with

| Magazine | Feed |
| --- | --- |
| Aeon | `https://aeon.co/essays/feed.rss`. Essays only; the main feed is half videos. |
| JSTOR Daily | `https://daily.jstor.org/feed/` |
| The Atlantic | `https://www.theatlantic.com/feed/all/` |
| The New York Times | `https://rss.nytimes.com/services/xml/rss/nyt/HomePage.xml` (top stories) |
| Epoché Magazine | `https://epochemagazine.org/feed/` |
| The Public Domain Review | `https://publicdomainreview.org/rss.xml` |
| The New York Review of Books | `https://www.nybooks.com/feed/?post_type=article` (the print issue) and `https://www.nybooks.com/feed/?post_type=daily` (the online pieces), merged. The site's main feed is empty. |

Authors are hidden for Epoché and The New York Review of Books, because their feeds name the editor who posted each piece. Switch any magazine off, reorder the list or remove what you do not read.

## Settings

| Setting | What it does |
| --- | --- |
| Note | Where the page lives. The default is `Reading Room.md`, made the first time you open it. |
| Page title | The name across the top. The default is *The Reading Room*. |
| Articles per magazine | 3 to 30. The default of 9 gives a lead story and two full rows of four. |
| Check for new articles | Every 15 minutes to every 12 hours; every hour by default. It also checks when Obsidian starts, if the last check is older than that. |
| Show standfirsts | The short introduction under each headline. |
| Keep articles for | How long an article stays after it leaves its feed: from not at all to a month; a week by default. |
| Language of the page | English or Spanish, for the dates, labels and menus on the page. The settings stay in English. |
| Always open in reading view | Switches the note to reading view each time it opens. On by default. |
| Magazines | Switch each on or off, reorder, edit (name, website, feeds, what to leave out, colour, authors), remove or add. |
| Clip to vault | Import, order and remove Web Clipper templates, and choose whether a clipped note opens straight away. |

Two commands, *Open the reading room* and *Check for new articles now*, and a newspaper icon in the left ribbon that opens the page.

## The page in other notes

The note holds a single code block, and you can put the same block in any other note, a daily note or a dashboard. Two optional lines narrow it down:

````markdown
```magazine-rack
magazines: Aeon, JSTOR Daily
articles: 6
```
````

The articles, your saved list and what you have read are kept in the plugin's data file (`.obsidian/plugins/magazine-rack/data.json`), so the note itself never changes when new pieces arrive. If your vault is under git, you may want to ignore that file, since it changes at every check.

## Install

**With BRAT.** Install the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, choose *Add beta plugin*, and enter `CasaAmarillaRoja/reading_room`.

**By hand.** Download `main.js`, `manifest.json` and `styles.css` from the [latest release](https://github.com/CasaAmarillaRoja/reading_room/releases/latest) into `<your vault>/.obsidian/plugins/magazine-rack/`.

Then switch on **Magazine Rack** in Settings → Community plugins, and click the newspaper icon in the left ribbon.

## Privacy

Magazine Rack talks only to the magazines you list: their feeds, their article pages (for pictures, and when you clip an article) and their image servers. It has no account, no analytics and no server of its own. What it keeps is stored in the plugin's data file inside your vault.

## Support

Magazine Rack is free and open source. If it is useful to you, you can support its development on [Ko-fi](https://ko-fi.com/ducktapekiller): there is a small heart in the corner of the page's masthead, and a *Support* section at the end of the settings.

## Building from source

```bash
npm install
```

```bash
npm run build
```

This writes `main.js` next to `manifest.json` and `styles.css`.

Magazine Rack bundles Defuddle, Knap and Day.js, and Defuddle's full build includes Turndown and mathml-to-latex. All are MIT-licensed; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Author and licence

Made by **DuckTapeKiller**. Released under the [MIT licence](LICENSE).
