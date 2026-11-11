import { Link } from 'react-router-dom';

function LandingPage(): JSX.Element {
    return (
        <div className="page landing-page">
            <section className="hero">
                <h2>Welcome to Trivia Control Center</h2>
                <p>
                    Pick the perspective that matches your role and follow the prompts to join the live trivia game. All
                    experiences stay in sync live, wherever you join.
                </p>
            </section>

            <section className="role-grid">
                <article className="panel role-card">
                    <h3>Team</h3>
                    <p>Join a game, claim your team name, submit answers, and lock in wagers during the final round.</p>
                    <Link className="primary" to="/team">
                        Enter Team View
                    </Link>
                </article>

                <article className="panel role-card">
                    <h3>Gamemaster</h3>
                    <p>
                        Create games, import question sets, manage rounds, and grade submissions. Use your host secret to
                        unlock controls.
                    </p>
                    <Link className="primary" to="/gamemaster">
                        Go to Gamemaster Tools
                    </Link>
                </article>

                <article className="panel role-card">
                    <h3>Scoreboard</h3>
                    <p>
                        Display a projection-friendly scoreboard that updates instantly as the gamemaster awards points.
                        No PIN or sign-in required.
                    </p>
                    <Link className="primary" to="/scoreboard">
                        Launch Scoreboard
                    </Link>
                </article>
            </section>
        </div>
    );
}

export default LandingPage;
