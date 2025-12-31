import type { ContributionDay, Provider } from "./types";
import { addDays, formatISODate, listDateRange, parseISODate } from "./utils";

const DEFAULT_TIMEOUT_MS = 5000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const fetchWithBackoff = async (
  url: string,
  options: RequestInit = {},
  tries = 3
): Promise<Response> => {
  let delay = 400;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
    try {
      const headers = {
        "user-agent": "ZeroCommitsAreLava/1.0",
        accept: "text/html,application/xhtml+xml",
        "accept-language": "en-US,en;q=0.9",
        ...(options.headers || {}),
      };
      const response = await fetch(url, {
        ...options,
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.status >= 500 || response.status === 429) {
        if (attempt < tries - 1) {
          await sleep(delay);
          delay *= 2;
          continue;
        }
      }
      return response;
    } catch (error) {
      clearTimeout(timeout);
      if (attempt < tries - 1) {
        await sleep(delay);
        delay *= 2;
        continue;
      }
      throw error;
    }
  }
  throw new Error("fetchWithBackoff failed unexpectedly");
};

const parseGithubHtml = (html: string): Map<string, number> => {
  const map = new Map<string, number>();
  const patterns: Array<{ regex: RegExp; dateIndex: number; countIndex: number }> = [
    { regex: /data-date=['"](\d{4}-\d{2}-\d{2})['"][^>]*data-count=['"](\d+)['"]/g, dateIndex: 1, countIndex: 2 },
    { regex: /data-count=['"](\d+)['"][^>]*data-date=['"](\d{4}-\d{2}-\d{2})['"]/g, dateIndex: 2, countIndex: 1 },
    { regex: /data-date=['"](\d{4}-\d{2}-\d{2})['"][^>]*data-level=['"](\d+)['"]/g, dateIndex: 1, countIndex: 2 },
    { regex: /data-level=['"](\d+)['"][^>]*data-date=['"](\d{4}-\d{2}-\d{2})['"]/g, dateIndex: 2, countIndex: 1 },
  ];

  patterns.forEach(({ regex, dateIndex, countIndex }) => {
    let match: RegExpExecArray | null = null;
    while ((match = regex.exec(html))) {
      const date = match[dateIndex];
      const count = Number(match[countIndex]);
      map.set(date, count);
    }
  });

  return map;
};

const sliceDays = (map: Map<string, number>, from: string, to: string): ContributionDay[] => {
  return listDateRange(from, to).map((date) => ({
    date,
    count: map.get(date) ?? 0,
  }));
};

const fetchGithubContribWithToken = async (
  username: string,
  from: string,
  to: string,
  token: string
): Promise<ContributionDay[]> => {
  const query = `
    query($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                date
                contributionCount
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetchWithBackoff(
    "https://api.github.com/graphql",
    {
      method: "POST",
      headers: {
        authorization: `bearer ${token}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        query,
        variables: {
          login: username,
          from: `${from}T00:00:00Z`,
          to: `${to}T23:59:59Z`,
        },
      }),
    },
    2
  );

  if (!response.ok) {
    throw new Error(`GitHub API returned ${response.status}.`);
  }

  const data = (await response.json()) as {
    data?: {
      user?: {
        contributionsCollection?: {
          contributionCalendar?: {
            weeks?: Array<{
              contributionDays?: Array<{
                date: string;
                contributionCount: number;
              }>;
            }>;
          };
        };
      };
    };
    errors?: Array<{ message: string }>;
  };

  if (data.errors?.length) {
    throw new Error(data.errors[0].message);
  }

  const weeks = data.data?.user?.contributionsCollection?.contributionCalendar?.weeks || [];
  const days: ContributionDay[] = [];
  weeks.forEach((week) => {
    week.contributionDays?.forEach((day) => {
      days.push({ date: day.date, count: day.contributionCount });
    });
  });

  return days;
};

export const fetchGithubContrib = async (
  username: string,
  from: string,
  to: string
): Promise<ContributionDay[]> => {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    try {
      const days = await fetchGithubContribWithToken(username, from, to, token);
      if (days.length > 0) {
        return days;
      }
    } catch (error) {
      console.warn("githubTokenFetchFailed", error);
    }
  }

  const url = new URL(`https://github.com/users/${encodeURIComponent(username)}/contributions`);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  const response = await fetchWithBackoff(url.toString());
  if (response.status === 404) {
    throw new Error("GitHub user not found.");
  }
  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status}.`);
  }
  const html = await response.text();
  let map = parseGithubHtml(html);
  if (map.size === 0) {
    const fallbackUrl = new URL(`https://github.com/${encodeURIComponent(username)}`);
    fallbackUrl.searchParams.set("tab", "overview");
    fallbackUrl.searchParams.set("from", from);
    fallbackUrl.searchParams.set("to", to);
    const fallbackResponse = await fetchWithBackoff(fallbackUrl.toString());
    if (fallbackResponse.ok) {
      const fallbackHtml = await fallbackResponse.text();
      map = parseGithubHtml(fallbackHtml);
    }
  }
  if (map.size === 0) {
    throw new Error("GitHub contributions unavailable right now. Try again shortly.");
  }
  return sliceDays(map, from, to);
};

export const fetchGitlabContrib = async (
  username: string,
  from: string,
  to: string,
  host: string
): Promise<ContributionDay[]> => {
  const url = `https://${host}/users/${encodeURIComponent(username)}/calendar.json`;
  const response = await fetchWithBackoff(url);
  if (response.status === 404) {
    throw new Error("GitLab user not found or calendar.json unavailable.");
  }
  if (response.status === 403) {
    throw new Error("This GitLab instance doesn't expose calendar.json publicly.");
  }
  if (!response.ok) {
    throw new Error(`GitLab returned ${response.status}.`);
  }
  const data = (await response.json()) as Record<string, number>;
  const map = new Map<string, number>(Object.entries(data).map(([date, count]) => [date, count]));
  return sliceDays(map, from, to);
};

export const fetchProviderDays = async (
  provider: Provider,
  username: string,
  from: string,
  to: string,
  gitlabHost: string
): Promise<ContributionDay[]> => {
  if (provider === "github") {
    return fetchGithubContrib(username, from, to);
  }
  return fetchGitlabContrib(username, from, to, gitlabHost);
};

export const expandToWeekRange = (startWeek: string, weeks: number) => {
  const start = parseISODate(startWeek);
  const end = addDays(start, weeks * 7 - 1);
  return {
    from: formatISODate(start),
    to: formatISODate(end),
  };
};
