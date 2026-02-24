export default function SelectField({ value, onChange, children }) {
  return (
    <select className="select-unified" value={value} onChange={onChange}>
      {children}
    </select>
  );
}
