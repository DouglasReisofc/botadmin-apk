//import node modules libraries
import { Container } from "react-bootstrap";

const ErrorLayout = ({ children }: { children: React.ReactNode }) => {
  return (
    <main>
      <Container className="justify-content-center align-items-center d-flex flex-column vh-100">
        {children}
      </Container>
    </main>
  );
};

export default ErrorLayout;
