"use client";

import Link from "next/link";
import { Fragment } from "react";
import { Button, Col, Image, Row } from "react-bootstrap";

interface NotFoundClientProps {
  assetPath: string;
}

const NotFoundClient = ({ assetPath }: NotFoundClientProps) => {
  return (
    <Fragment>
      <Row className="justify-content-center">
        <Col>
          <div className="text-center">
            <div>
              <Image src={assetPath} alt="Image" className="img-fluid" />
            </div>

            <h1 className="display-4">Oops! A pagina não foi encontrada</h1>
            <p className="mb-6 fs-5">
              Talvez ela ainda esteja sendo desenvolvida ou foi movida para outro endereço
            </p>

            <Button as={Link} href="/" variant="primary" size="lg">
              Ir para a pagina inicial
            </Button>
          </div>
        </Col>
      </Row>
    </Fragment>
  );
};

export default NotFoundClient;
