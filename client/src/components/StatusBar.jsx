export default function StatusBar({ connected, primaryConnected }) {
  return (
    <div className="status-bar" style={styles.wrapper}>
      <Indicator label="BACKEND" on={connected} />
      <Indicator label="PRIMARY WS" on={primaryConnected} />
    </div>
  );
}

function Indicator({ label, on }) {
  return (
    <div style={styles.item}>
      <div
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          backgroundColor: on ? 'var(--green)' : 'var(--red)',
          boxShadow: on ? 'var(--green-glow)' : '0 0 6px var(--red-dim)',
          transition: 'all 0.3s',
          flexShrink: 0,
        }}
      />
      <span style={{ ...styles.label, color: on ? 'var(--green)' : 'var(--red)' }}>
        {label}
      </span>
    </div>
  );
}

// flex-direction se conmuta a column en mobile vía clase `.status-bar` en
// index.css (media query @720px). Así "BACKEND" y "PRIMARY WS" quedan en
// dos líneas apiladas en lugar de wrappear el texto interno del label.
const styles = {
  wrapper: {
    display: 'flex',
    gap: 14,
    alignItems: 'center',
  },
  item: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  label: {
    fontFamily: "'Roboto Mono', monospace",
    fontSize: 10,
    fontWeight: 500,
    letterSpacing: 1.5,
    whiteSpace: 'nowrap',
  },
};
