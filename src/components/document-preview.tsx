import * as stylex from "@stylexjs/stylex";
import { Icon, StaticButton } from "./ui/primitives";
import { colors } from "../styles/tokens.stylex";

const sections = [
  {
    title: "What matters",
    body: "A shared inbox, a useful help center, and pricing that stays clear as we grow.",
  },
  {
    title: "Help Scout",
    body: "A focused option for an email-first team.",
    note: "Check collaboration limits on the entry plan.",
  },
  {
    title: "Front",
    body: "Worth exploring for shared team workflows.",
    note: "Confirm which plan includes the help center.",
  },
  {
    title: "Zendesk",
    body: "The broadest option on the shortlist.",
    note: "Check setup effort against what we need.",
  },
];
export function DocumentPreview() {
  return (
    <aside
      aria-label="Support tool comparison draft"
      {...stylex.props(styles.panel)}
    >
      <header {...stylex.props(styles.header)}>
        <Icon name="file" size={15} />
        <span {...stylex.props(styles.headerTitle)}>
          Support tool comparison
        </span>
        <StaticButton label="Document options">
          <Icon name="more" size={14} />
        </StaticButton>
        <StaticButton label="Close document">
          <Icon name="close" size={14} />
        </StaticButton>
      </header>
      <article {...stylex.props(styles.document)}>
        <p {...stylex.props(styles.eyebrow)}>Draft</p>
        <h1 {...stylex.props(styles.title)}>
          Choosing our next
          <br />
          support tool
        </h1>
        <p {...stylex.props(styles.subtitle)}>
          A shortlist for our five-person team.
        </p>
        {sections.map((section) => (
          <section key={section.title} {...stylex.props(styles.section)}>
            <h2 {...stylex.props(styles.sectionTitle)}>{section.title}</h2>
            <p {...stylex.props(styles.body)}>{section.body}</p>
            {section.note && (
              <p {...stylex.props(styles.note)}>{section.note}</p>
            )}
          </section>
        ))}
        <p {...stylex.props(styles.footnote)}>
          Pricing and plan limits are still being verified.
        </p>
      </article>
    </aside>
  );
}
const styles = stylex.create({
  panel: {
    width: { default: "43%", "@media (max-width: 1100px)": "40%" },
    minWidth: 290,
    display: { default: "flex", "@media (max-width: 900px)": "none" },
    flexDirection: "column",
    backgroundColor: colors.surface,
    borderLeftWidth: 1,
    borderLeftStyle: "solid",
    borderLeftColor: colors.border,
  },
  header: {
    display: "flex",
    alignItems: "center",
    gap: 9,
    minHeight: 42,
    paddingInline: 18,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
    color: colors.muted,
  },
  headerTitle: { flex: 1, fontSize: 11, color: colors.foreground },
  document: {
    paddingTop: 30,
    paddingInline: { default: 30, "@media (max-width: 1100px)": 23 },
    paddingBottom: 24,
    display: "flex",
    flexDirection: "column",
    flex: 1,
    overflowY: "auto",
  },
  eyebrow: {
    margin: 0,
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    color: colors.muted,
  },
  title: {
    margin: 0,
    marginTop: 13,
    fontSize: 26,
    fontWeight: 500,
    lineHeight: 1.28,
    letterSpacing: "-0.7px",
  },
  subtitle: {
    fontSize: 12,
    color: colors.muted,
    marginTop: 12,
    marginBottom: 14,
  },
  section: {
    paddingBlock: 22,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: colors.border,
  },
  sectionTitle: { margin: 0, fontSize: 13, fontWeight: 600 },
  body: { fontSize: 12, margin: 0, marginTop: 8, lineHeight: 1.75 },
  note: {
    fontSize: 11,
    margin: 0,
    marginTop: 6,
    lineHeight: 1.65,
    color: colors.muted,
  },
  footnote: {
    fontSize: 10,
    color: colors.muted,
    margin: 0,
    marginTop: "auto",
    paddingTop: 38,
  },
});
