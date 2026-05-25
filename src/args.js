export function parseArgs(rawArgs) {
  const args = [];
  const options = {};
  let command = rawArgs[0];

  if (command?.startsWith("-")) {
    command = undefined;
  }

  for (let i = command ? 1 : 0; i < rawArgs.length; i += 1) {
    const arg = rawArgs[i];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--oneline") {
      options.oneline = true;
    } else if (arg === "-n" || arg === "--max-count") {
      options.maxCount = rawArgs[++i];
    } else if (arg.startsWith("--max-count=")) {
      options.maxCount = arg.slice("--max-count=".length);
    } else if (/^-\d+$/.test(arg)) {
      options.maxCount = arg.slice(1);
    } else if (arg === "--all") {
      options.all = true;
    } else if (arg === "--latest") {
      options.latest = true;
    } else if (arg === "--current") {
      options.current = true;
    } else if (arg.startsWith("--agent=")) {
      options.agent = arg.slice("--agent=".length);
    } else if (arg === "--agent") {
      options.agent = rawArgs[++i];
    } else if (arg.startsWith("--author=")) {
      options.author = arg.slice("--author=".length);
    } else if (arg === "--author") {
      options.author = rawArgs[++i];
    } else if (arg.startsWith("--bundle=")) {
      options.bundle = arg.slice("--bundle=".length);
    } else if (arg === "--bundle") {
      options.bundle = rawArgs[++i];
    } else if (arg.startsWith("--date=")) {
      options.date = arg.slice("--date=".length);
    } else if (arg === "--date") {
      options.date = rawArgs[++i];
    } else if (arg.startsWith("--title=")) {
      options.title = arg.slice("--title=".length);
    } else if (arg === "--title") {
      options.title = rawArgs[++i];
    } else if (arg === "--no-adapt") {
      options.noAdapt = true;
    } else if (arg === "--no-register") {
      options.noRegister = true;
    } else if (arg.startsWith("--m=")) {
      options.message = arg.slice("--m=".length);
    } else if (arg === "--m" || arg === "-m" || arg === "--message") {
      options.message = rawArgs[++i];
    } else if (arg.startsWith("--message=")) {
      options.message = arg.slice("--message=".length);
    } else if (arg.startsWith("--index=")) {
      options.index = arg.slice("--index=".length);
    } else if (arg === "--index") {
      options.index = rawArgs[++i];
    } else if (arg.startsWith("--i=")) {
      options.index = arg.slice("--i=".length);
    } else if (arg === "--i") {
      options.index = rawArgs[++i];
    } else if (arg.startsWith("--branch=")) {
      options.branch = arg.slice("--branch=".length);
    } else if (arg === "--branch") {
      options.branch = rawArgs[++i];
    } else if (arg.startsWith("--commit=")) {
      options.commit = arg.slice("--commit=".length);
    } else if (arg === "--commit") {
      options.commit = rawArgs[++i];
    } else if (arg.startsWith("--remote=")) {
      options.remote = arg.slice("--remote=".length);
    } else if (arg === "--remote") {
      options.remote = rawArgs[++i];
    } else if (arg.startsWith("--store=")) {
      options.store = arg.slice("--store=".length);
    } else if (arg === "--store") {
      options.store = rawArgs[++i];
    } else {
      args.push(arg);
    }
  }

  return { command, args, options };
}

export function parseSelector(options, { requireSelector }) {
  const selectors = [
    options.latest ? { type: "latest" } : null,
    options.current ? { type: "current" } : null,
    isLegacySelectorOption(options, "branch") ? { type: "branch", value: options.branch } : null,
    isLegacySelectorOption(options, "commit") ? { type: "commit", value: options.commit } : null
  ].filter(Boolean);

  if (selectors.length > 1) {
    throw new Error("choose only one of --latest, --current, --branch, or --commit");
  }
  if (!selectors.length) {
    if (requireSelector) {
      throw new Error("log requires one of --latest, --current, --branch, or --commit");
    }
    return null;
  }

  const selector = selectors[0];
  if ((selector.type === "branch" || selector.type === "commit") && !selector.value) {
    throw new Error(`--${selector.type} requires a value`);
  }
  return selector;
}

function isLegacySelectorOption(options, name) {
  return options[name] !== undefined && !hasPrimarySelector(options) && !hasBindingFilters(options);
}

function hasPrimarySelector(options) {
  return Boolean(options.latest || options.current);
}

export function hasBindingFilters(options) {
  return [
    options.agent,
    options.author,
    options.bundle,
    options.date,
    options.title
  ].some((value) => value !== undefined);
}

export function parseBindingFilters(options, selector = null) {
  const filters = {
    agent: parseOptionalFilter(options, "agent"),
    author: parseOptionalFilter(options, "author"),
    bundle: parseOptionalFilter(options, "bundle"),
    date: parseOptionalFilter(options, "date"),
    title: parseOptionalFilter(options, "title"),
    branch: selector?.type === "branch" ? null : parseOptionalFilter(options, "branch"),
    commit: selector?.type === "commit" ? null : parseOptionalFilter(options, "commit")
  };

  const active = Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null));
  if (active.agent && !["codex", "claude"].includes(active.agent)) {
    throw new Error("--agent must be one of codex or claude");
  }
  if (active.date && !/^\d{4}-\d{2}-\d{2}$/.test(active.date)) {
    throw new Error("--date must use YYYY-MM-DD");
  }
  return active;
}

export function hasActiveBindingFilters(filters) {
  return Object.keys(filters || {}).length > 0;
}

export function formatBindingFiltersForCommand(filters) {
  return Object.entries(filters || {})
    .map(([name, value]) => `--${name} ${shellQuote(String(value))}`)
    .join(" ");
}

function parseOptionalFilter(options, name) {
  if (options[name] === undefined) {
    return null;
  }
  const value = String(options[name]).trim();
  if (!value) {
    throw new Error(`--${name} requires a value`);
  }
  return value;
}

function shellQuote(value) {
  return /^[A-Za-z0-9_./:@+-]+$/.test(value)
    ? value
    : JSON.stringify(value);
}

export function formatSelector(selector) {
  if (selector.type === "latest") {
    return "latest";
  }
  if (selector.type === "current") {
    return "current";
  }
  return `${selector.type} ${selector.value}`;
}
