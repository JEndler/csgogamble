import { describe, expect, it } from 'vitest';
import { discoverMatchUrls, isCloudflareChallenge, parseMatchHtml } from '../src/hltv';

describe('hltv parsing helpers', () => {
  it('detects Cloudflare challenge pages', () => {
    expect(isCloudflareChallenge('<title>Just a moment...</title>')).toBe(true);
    expect(isCloudflareChallenge('<html><body>real page</body></html>')).toBe(false);
  });

  it('discovers unique match URLs from results html', () => {
    const html = [
      '<a href="/matches/123/alpha-vs-beta">one</a>',
      '<a href="https://www.hltv.org/matches/123/alpha-vs-beta">dupe</a>',
      '<a href="/matches/456/gamma-vs-delta">two</a>',
    ].join('');

    expect(discoverMatchUrls('https://www.hltv.org', html)).toEqual([
      'https://www.hltv.org/matches/123/alpha-vs-beta',
      'https://www.hltv.org/matches/456/gamma-vs-delta',
    ]);
  });

  it('parses a basic non-challenge match page', () => {
    const html = `
      <div class="team1-gradient"><a href="/team/10/team-one"><div class="teamName">Team One</div></a><div class="score">2</div></div>
      <div class="team2-gradient"><a href="/team/20/team-two"><div class="teamName">Team Two</div></a><div class="score">1</div></div>
      <div class="event text-ellipsis" title="Test Event"></div>
      <div class="preformatted-text">Best of 3</div>
      <div class="timeAndEvent"><div class="date" data-unix="1710000000000"></div></div>
      <div class="mapholder">
        <div class="mapname">Inferno</div>
        <a href="/stats/matches/performance/mapstatsid/999/test"></a>
        <div class="results">
          <div class="results-team-score">13</div>
          <div class="results-team-score">8</div>
        </div>
      </div>
      <a class="stream-box" data-demo-link-button="" data-demo-link="/download/demo/12345"></a>
    `;

    const parsed = parseMatchHtml('https://www.hltv.org/matches/777/example-match', html);
    expect(parsed.hltvMatchId).toBe(777);
    expect(parsed.team1.hltvTeamId).toBe(10);
    expect(parsed.team2.hltvTeamId).toBe(20);
    expect(parsed.team1Score).toBe(2);
    expect(parsed.team2Score).toBe(1);
    expect(parsed.eventName).toBe('Test Event');
    expect(parsed.bestOf).toBe(3);
    expect(parsed.maps).toHaveLength(1);
    expect(parsed.maps[0]?.hltvMapId).toBe(999);
    expect(parsed.rawDemoUrl).toContain('/download/demo/12345');
  });

  it('drops duplicate placeholder TBA maps so D1 unique constraints are not hit', () => {
    const html = `
      <div class="team1-gradient"><a href="/team/10/team-one"><div class="teamName">Team One</div></a></div>
      <div class="team2-gradient"><a href="/team/20/team-two"><div class="teamName">Team Two</div></a></div>
      <div class="mapholder"><div class="mapname">TBA</div></div>
      <div class="mapholder"><div class="mapname">TBA</div></div>
    `;

    const parsed = parseMatchHtml('https://www.hltv.org/matches/888/example-match', html);
    expect(parsed.maps).toEqual([]);
  });

  it('extracts per-map player stats from stats-content sections', () => {
    const html = `
      <div class="team1-gradient"><a href="/team/10/team-one"><div class="teamName">Team One</div></a><div class="score">2</div></div>
      <div class="team2-gradient"><a href="/team/20/team-two"><div class="teamName">Team Two</div></a><div class="score">1</div></div>
      <div class="mapholder">
        <div class="mapname">Inferno</div>
        <a href="/stats/matches/performance/mapstatsid/999/test"></a>
        <div class="results">
          <div class="results-team-score">13</div>
          <div class="results-team-score">8</div>
        </div>
      </div>
      <div class="stats-content" id="999-content">
        <table class="table totalstats">
          <tbody>
            <tr class="header-row">
              <td class="players">
                <div class="align-logo"><a href="/team/10/team-one" class="teamName team">Team One</a></div>
              </td>
            </tr>
            <tr>
              <td class="players">
                <div class="flagAlign"><a href="/player/1001/player-one" class="text-ellipsis"><div class="smartphone-only statsPlayerName text-ellipsis">p1</div></a></div>
              </td>
              <td class="kd text-center traditional-data">22-15</td>
              <td class="adr text-center traditional-data">87.3</td>
              <td class="kast text-center traditional-data">76.7%</td>
              <td class="rating text-center ratingPositive">1.34</td>
            </tr>
          </tbody>
        </table>
        <table class="table totalstats">
          <tbody>
            <tr class="header-row">
              <td class="players">
                <div class="align-logo"><a href="/team/20/team-two" class="teamName team">Team Two</a></div>
              </td>
            </tr>
            <tr>
              <td class="players">
                <div class="flagAlign"><a href="/player/2002/player-two" class="text-ellipsis"><div class="smartphone-only statsPlayerName text-ellipsis">p2</div></a></div>
              </td>
              <td class="kd text-center traditional-data">10-18</td>
              <td class="adr text-center traditional-data">55.1</td>
              <td class="kast text-center traditional-data">60.0%</td>
              <td class="rating text-center ratingNegative">0.78</td>
            </tr>
          </tbody>
        </table>
      </div>
    `;

    const parsed = parseMatchHtml('https://www.hltv.org/matches/999/example-match', html);
    expect(parsed.playerStats).toHaveLength(2);
    expect(parsed.playerStats[0]).toMatchObject({
      playerHltvId: 1001,
      nickname: 'p1',
      teamHltvId: 10,
      mapName: 'Inferno',
      kills: 22,
      deaths: 15,
      adr: 87.3,
      kast: 76.7,
      rating: 1.34,
      sourceUrl: 'https://www.hltv.org/stats/matches/performance/mapstatsid/999/test',
    });
    expect(parsed.playerStats[1]).toMatchObject({
      playerHltvId: 2002,
      nickname: 'p2',
      teamHltvId: 20,
      mapName: 'Inferno',
      kills: 10,
      deaths: 18,
      adr: 55.1,
      kast: 60,
      rating: 0.78,
    });
  });
});

const ENRICHED_MATCH_HTML = `
  <div class="timeAndEvent">
    <div class="date" data-unix="1710000000000"></div>
    <div class="event text-ellipsis"><a href="/events/7777/super-cup" title="Super Cup"><span>Super Cup</span></a></div>
  </div>
  <div class="standard-headline">Match over</div>
  <div class="teamsBox">
    <div class="team1-gradient">
      <a href="/team/10/team-one"><div class="teamName">Team One</div></a>
      <div class="teamRanking"><a href="/ranking/teams/2025">World rank: <span>#5</span></a></div>
      <div class="won">2</div>
    </div>
    <div class="team2-gradient">
      <a href="/team/20/team-two"><div class="teamName">Team Two</div></a>
      <div class="teamRanking"><a href="/ranking/teams/2025">World rank: <span>#12</span></a></div>
      <div class="lost">1</div>
    </div>
  </div>
  <div class="padding preformatted-text">Best of 3 (LAN)
Grand Final
Cologne, Germany</div>

  <div class="lineups">
    <div class="lineup standard-box" data-team-id="10">
      <a href="/player/1001/p1"><div class="text-ellipsis">p1</div></a>
      <a href="/player/1002/p2"><div class="text-ellipsis">p2</div></a>
      <a href="/player/1003/p3"><div class="text-ellipsis">p3</div></a>
      <a href="/player/1004/p4"><div class="text-ellipsis">p4</div></a>
      <a href="/player/1005/p5"><div class="text-ellipsis">p5</div></a>
    </div>
    <div class="lineup standard-box" data-team-id="20">
      <a href="/player/2001/e1"><div class="text-ellipsis">e1</div></a>
    </div>
  </div>

  <div class="standard-box veto-box">
    <div class="padding">
      <div>1. Team One <b>removed</b> Mirage</div>
      <div>2. Team Two <b>removed</b> Anubis</div>
      <div>3. Team One <b>picked</b> Inferno</div>
      <div>4. Team Two <b>picked</b> Nuke</div>
      <div>5. Team One <b>removed</b> Dust2</div>
      <div>6. Team Two <b>removed</b> Vertigo</div>
      <div>7. Ancient was left over</div>
    </div>
  </div>

  <div class="mapholder">
    <div class="mapname">Inferno</div>
    <div class="results">
      <div class="results-team-score won">13</div>
      <div class="results-team-score lost">8</div>
    </div>
    <div class="results-center-half-score">(<span class="ct">8</span>:<span class="t">4</span>; <span class="t">5</span>:<span class="ct">4</span>)</div>
    <div class="results-center"><div class="pick"><div class="results-teamname text-ellipsis">Team One</div></div></div>
    <a href="/stats/matches/performance/mapstatsid/100/inferno">Performance</a>
    <a href="/stats/matches/mapstatsid/100/inferno">Stats</a>
  </div>

  <div class="mapholder">
    <div class="mapname">Nuke</div>
    <div class="results">
      <div class="results-team-score lost">9</div>
      <div class="results-team-score won">13</div>
    </div>
    <div class="results-center-half-score">(<span class="ct">4</span>:<span class="t">8</span>; <span class="t">5</span>:<span class="ct">5</span>)</div>
    <div class="results-center"><div></div><div class="pick"><div class="results-teamname text-ellipsis">Team Two</div></div></div>
    <a href="/stats/matches/performance/mapstatsid/101/nuke">Performance</a>
  </div>

  <div class="streams">
    <div class="stream-box">
      <a href="https://twitch.tv/example" class="stream-box-embed"></a>
      <div class="stream-flag-styling">EN</div>
      <div class="stream-name">English Stream</div>
      <div class="viewers">15234</div>
    </div>
  </div>

  <div class="stats-content" id="all-content">
    <table class="table totalstats">
      <tbody>
        <tr class="header-row">
          <td class="players">
            <div class="align-logo"><a href="/team/10/team-one" class="teamName team">Team One</a></div>
          </td>
        </tr>
        <tr>
          <td class="players">
            <div class="flagAlign"><a href="/player/1001/player-one" class="text-ellipsis"><div class="smartphone-only statsPlayerName text-ellipsis">p1</div></a></div>
          </td>
          <td class="kd text-center traditional-data">42-30</td>
          <td class="plus-minus text-center traditional-data">+12</td>
          <td class="adr text-center traditional-data">88.1</td>
          <td class="kast text-center traditional-data">77.0%</td>
          <td class="rating text-center ratingPositive" data-rating-version="2.0">1.28</td>
        </tr>
      </tbody>
    </table>
  </div>

  <a data-demo-link="/download/demo/12345"></a>
`;

describe('hltv enrichment', () => {
  it('parses event id, source URL, and name', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', ENRICHED_MATCH_HTML);
    expect(parsed.eventHltvId).toBe(7777);
    expect(parsed.eventSourceUrl).toBe('https://www.hltv.org/events/7777/super-cup');
    expect(parsed.eventName).toBe('Super Cup');
  });

  it('parses match status, stage, format, and location', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', ENRICHED_MATCH_HTML);
    expect(parsed.matchStatus).toBe('Match over');
    expect(parsed.matchFormat).toBe('Best of 3 (LAN)');
    expect(parsed.matchStage).toBe('Grand Final');
    expect(parsed.matchLocation).toBe('Cologne, Germany');
  });

  it('parses team world ranks alongside team summary', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', ENRICHED_MATCH_HTML);
    expect(parsed.team1.rank).toBe(5);
    expect(parsed.team2.rank).toBe(12);
  });

  it('parses lineups per team', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', ENRICHED_MATCH_HTML);
    expect(parsed.lineup).toHaveLength(6);
    expect(parsed.lineup.filter((p) => p.teamHltvId === 10)).toHaveLength(5);
    expect(parsed.lineup.filter((p) => p.teamHltvId === 20)).toHaveLength(1);
    expect(parsed.lineup[0]).toMatchObject({ playerHltvId: 1001, nickname: 'p1', teamHltvId: 10 });
  });

  it('parses veto steps with order, action, team, map', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', ENRICHED_MATCH_HTML);
    expect(parsed.vetoes).toHaveLength(7);
    expect(parsed.vetoes[0]).toEqual({
      order: 1,
      action: 'ban',
      teamHltvId: 10,
      teamName: 'Team One',
      mapName: 'Mirage',
    });
    expect(parsed.vetoes[2]).toEqual({
      order: 3,
      action: 'pick',
      teamHltvId: 10,
      teamName: 'Team One',
      mapName: 'Inferno',
    });
    expect(parsed.vetoes[6]).toEqual({
      order: 7,
      action: 'remainder',
      teamHltvId: null,
      teamName: null,
      mapName: 'Ancient',
    });
  });

  it('enriches maps with order, status, pick team, winner, half scores, performance URL', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', ENRICHED_MATCH_HTML);
    const [inferno, nuke] = parsed.maps;
    expect(inferno).toMatchObject({
      mapName: 'Inferno',
      order: 1,
      status: 'played',
      pickTeamHltvId: 10,
      winnerTeamHltvId: 10,
      team1HalfScores: [8, 5],
      team2HalfScores: [4, 4],
      performanceUrl: 'https://www.hltv.org/stats/matches/performance/mapstatsid/100/inferno',
    });
    expect(nuke).toMatchObject({
      mapName: 'Nuke',
      order: 2,
      status: 'played',
      pickTeamHltvId: 20,
      winnerTeamHltvId: 20,
      team1HalfScores: [4, 5],
      team2HalfScores: [8, 5],
    });
  });

  it('parses streams', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', ENRICHED_MATCH_HTML);
    expect(parsed.streams).toHaveLength(1);
    expect(parsed.streams[0]).toMatchObject({
      name: 'English Stream',
      url: 'https://twitch.tv/example',
      language: 'EN',
      viewers: 15234,
    });
  });

  it('parses aggregate (all-maps) player stats with rating version and extras', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', ENRICHED_MATCH_HTML);
    expect(parsed.playerAggregateStats).toHaveLength(1);
    expect(parsed.playerAggregateStats[0]).toMatchObject({
      playerHltvId: 1001,
      nickname: 'p1',
      teamHltvId: 10,
      kills: 42,
      deaths: 30,
      kdDiff: 12,
      adr: 88.1,
      kast: 77,
      rating: 1.28,
      ratingVersion: '2.0',
    });
  });

  it('produces no parse warnings for a fully populated match page', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', ENRICHED_MATCH_HTML);
    expect(parsed.parseWarnings).toEqual([]);
  });

  it('records parse warnings when the page is missing expected sections', () => {
    const parsed = parseMatchHtml(
      'https://www.hltv.org/matches/9999/example',
      '<html><body>just some unrelated markup</body></html>',
    );
    expect(parsed.parseWarnings.length).toBeGreaterThan(0);
    expect(parsed.lineup).toEqual([]);
    expect(parsed.vetoes).toEqual([]);
    expect(parsed.streams).toEqual([]);
    expect(parsed.playerAggregateStats).toEqual([]);
  });

  it('returns empty enrichment fields for a Cloudflare challenge response', () => {
    const parsed = parseMatchHtml('https://www.hltv.org/matches/9999/example', '<title>Just a moment...</title>');
    expect(parsed.status).toBe('challenge');
    expect(parsed.eventHltvId).toBeNull();
    expect(parsed.matchStatus).toBeNull();
    expect(parsed.team1.rank).toBeNull();
    expect(parsed.team2.rank).toBeNull();
    expect(parsed.lineup).toEqual([]);
    expect(parsed.vetoes).toEqual([]);
    expect(parsed.streams).toEqual([]);
    expect(parsed.playerAggregateStats).toEqual([]);
    expect(parsed.parseWarnings).toEqual([]);
  });
});
