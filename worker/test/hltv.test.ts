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
