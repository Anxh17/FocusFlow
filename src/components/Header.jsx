export default function Header({ title, subtitle, action }) {
  return (
    <div className="page-header">
      <div className="page-header-inner">
        <div>
          <h1>{title}</h1>
          {subtitle && <div className="page-header-sub">{subtitle}</div>}
        </div>
        {action || null}
      </div>
    </div>
  );
}
